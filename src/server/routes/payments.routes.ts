import type { FastifyInstance } from 'fastify';
import type {
  PixMockWebhookRequest,
  PixMockWebhookResponse,
  ApiErrorResponse,
  DoorStatus,
  LockState,
  RentalStatus,
} from '../../shared/types.js';
import { db, insertDoorEvent, runImmediateTransaction } from '../db/connection.js';
import { expireOverdueReservations } from '../workers/ttl-worker.js';
import { broadcastCatalogStockUpdated, sendRentalStatusUpdated } from '../ws/broker.js';

interface WebhookQueryRow {
  rental_id: string;
  user_id: string;
  user_name: string;
  locker_id: string;
  door_id: string;
  door_number: number;
  door_status: DoorStatus;
  lock_state: LockState;
  rental_status: RentalStatus;
}

type WebhookTxOutcome =
  | { kind: 'NOT_FOUND' }
  | { kind: 'CONFLICT'; currentStatus: RentalStatus }
  | {
      kind: 'APPROVED';
      rentalId: string;
      userId: string;
      userName: string;
      lockerId: string;
      doorId: string;
      doorNumber: number;
      lockState: LockState;
      paidAt: string;
    };

/**
 * Rota de Checkout PIX Simulado / Webhook Interno (RF05, RN03)
 * Responsável Exclusivo: Dev 2 (Backend A — Card BE1-05)
 */
export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/payments/pix-mock-webhook
   * Aprova instantaneamente o pagamento PIX Mock de uma reserva vigente (`AWAITING_PAYMENT`),
   * liberando a locação para retirada (`PAID_READY_FOR_PICKUP`) e notificando em tempo real via WS.
   */
  app.post<{
    Body: PixMockWebhookRequest;
    Reply: PixMockWebhookResponse | ApiErrorResponse;
  }>('/api/payments/pix-mock-webhook', async (request, reply) => {
    const rentalId =
      typeof request.body?.rentalId === 'string' ? request.body.rentalId.trim() : '';

    if (!rentalId) {
      return reply.status(400).send({
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'O identificador da locação (rentalId) é obrigatório para confirmar o PIX.',
      });
    }

    // Garante que reservas cujo TTL já venceu sejam expiradas antes da aprovação
    expireOverdueReservations();

    const outcome = runImmediateTransaction<WebhookTxOutcome>(() => {
      const row = db
        .prepare(
          `SELECT
             r.id AS rental_id,
             r.user_id,
             u.name AS user_name,
             r.locker_id,
             r.door_id,
             d.door_number,
             d.status AS door_status,
             d.lock_state,
             r.status AS rental_status
           FROM rentals r
           JOIN doors d ON r.door_id = d.id
           JOIN users u ON r.user_id = u.id
           WHERE r.id = ?`,
        )
        .get(rentalId) as WebhookQueryRow | undefined;

      if (!row) {
        return { kind: 'NOT_FOUND' };
      }

      if (row.rental_status !== 'AWAITING_PAYMENT') {
        return { kind: 'CONFLICT', currentStatus: row.rental_status };
      }

      const paidAt = new Date().toISOString();

      db.prepare(
        `UPDATE payments
         SET status = 'PAID', paid_at = ?
         WHERE rental_id = ?`,
      ).run(paidAt, rentalId);

      db.prepare(
        `UPDATE rentals
         SET status = 'PAID_READY_FOR_PICKUP', paid_at = ?
         WHERE id = ? AND status = 'AWAITING_PAYMENT'`,
      ).run(paidAt, rentalId);

      db.prepare(
        `UPDATE doors
         SET status = 'AWAITING_PICKUP', updated_at = ?
         WHERE id = ?`,
      ).run(paidAt, row.door_id);

      insertDoorEvent({
        doorId: row.door_id,
        rentalId: row.rental_id,
        userId: row.user_id,
        eventType: 'STATUS_CHANGE',
        createdAt: paidAt,
        details: {
          from: row.door_status,
          to: 'AWAITING_PICKUP',
          trigger: 'PIX_MOCK_WEBHOOK',
        },
      });

      return {
        kind: 'APPROVED',
        rentalId: row.rental_id,
        userId: row.user_id,
        userName: row.user_name,
        lockerId: row.locker_id,
        doorId: row.door_id,
        doorNumber: row.door_number,
        lockState: row.lock_state,
        paidAt,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return reply.status(404).send({
        error: 'RENTAL_NOT_FOUND',
        message: 'Locação não encontrada para processamento do pagamento PIX.',
      });
    }

    if (outcome.kind === 'CONFLICT') {
      return reply.status(409).send({
        error: 'RENTAL_NOT_AWAITING_PAYMENT',
        message: `Esta reserva não pode ser paga pois está com status '${outcome.currentStatus}'.`,
      });
    }

    broadcastCatalogStockUpdated({
      lockerId: outcome.lockerId,
      door: {
        id: outcome.doorId,
        doorNumber: outcome.doorNumber,
        status: 'AWAITING_PICKUP',
        lockState: outcome.lockState,
        currentRentalId: outcome.rentalId,
        currentOccupantName: outcome.userName,
        expectedReturnAt: null,
      },
    });

    sendRentalStatusUpdated(outcome.userId, {
      rentalId: outcome.rentalId,
      status: 'PAID_READY_FOR_PICKUP',
      doorId: outcome.doorId,
      doorNumber: outcome.doorNumber,
      doorStatus: 'AWAITING_PICKUP',
      lockState: outcome.lockState,
      paidAt: outcome.paidAt,
    });

    return reply.status(200).send({
      success: true,
      rentalId: outcome.rentalId,
      rentalStatus: 'PAID_READY_FOR_PICKUP',
      doorStatus: 'AWAITING_PICKUP',
      paidAt: outcome.paidAt,
      canUnlock: true,
    });
  });
}
