/**
 * Rotina de Expiração Automática de Reserva (TTL - RF16)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */

import type { DoorStatus, LockState, RentalStatus } from '../../shared/types.js';
import { db, insertDoorEvent, runImmediateTransaction } from '../db/connection.js';
import { broadcastCatalogStockUpdated, sendRentalStatusUpdated } from '../ws/broker.js';

/** Prazo para destravar a porta depois do PIX aprovado (SPEC 4.1: AguardandoRetirada -> Disponivel). */
const PICKUP_TTL_MS = 10 * 60_000;

interface OverdueRentalRow {
  id: string;
  user_id: string;
  locker_id: string;
  door_id: string;
  rental_status: RentalStatus;
  door_number: number;
  lock_state: LockState;
  door_status: DoorStatus;
}

interface ExpiredRentalNotification {
  rentalId: string;
  userId: string;
  lockerId: string;
  doorId: string;
  doorNumber: number;
  lockState: LockState;
  doorStatus: DoorStatus;
  doorReleased: boolean;
}

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Cancela, numa transação `IMMEDIATE`, as locações que estouraram o prazo e libera as portas:
 * - reserva em `AWAITING_PAYMENT` com `reservation_expires_at` vencido (PIX expira);
 * - locação paga (`PAID_READY_FOR_PICKUP`) cuja porta nunca foi destravada até `PICKUP_TTL_MS`
 *   depois do pagamento (PIX estornado). Se a porta já abriu, o objeto pode estar com o aluno,
 *   então a locação nunca expira sozinha.
 * Só libera a porta que ainda aponta para a locação expirada. Os eventos WebSocket saem após o COMMIT.
 */
export function expireOverdueReservations(referenceNow: Date = new Date()): number {
  const nowIso = referenceNow.toISOString();
  const pickupDeadlineIso = new Date(referenceNow.getTime() - PICKUP_TTL_MS).toISOString();

  const expired = runImmediateTransaction<ExpiredRentalNotification[]>(() => {
    const overdueRows = db
      .prepare(
        `SELECT
           r.id,
           r.user_id,
           r.locker_id,
           r.door_id,
           r.status AS rental_status,
           d.door_number,
           d.lock_state,
           d.status AS door_status
         FROM rentals r
         JOIN doors d ON r.door_id = d.id
         WHERE (r.status = 'AWAITING_PAYMENT' AND r.reservation_expires_at <= ?)
            OR (r.status = 'PAID_READY_FOR_PICKUP' AND r.first_unlocked_at IS NULL AND r.paid_at <= ?)
         ORDER BY r.reservation_expires_at ASC`,
      )
      .all(nowIso, pickupDeadlineIso) as OverdueRentalRow[];

    if (overdueRows.length === 0) {
      return [];
    }

    const cancelRentalStmt = db.prepare(
      `UPDATE rentals
       SET status = 'CANCELLED', cancel_reason = 'EXPIRED_TTL'
       WHERE id = ? AND status = ?`,
    );

    const expireUnpaidPaymentStmt = db.prepare(
      `UPDATE payments
       SET status = 'EXPIRED'
       WHERE rental_id = ? AND status = 'PENDING'`,
    );

    const refundPaymentStmt = db.prepare(
      `UPDATE payments
       SET status = 'REFUNDED'
       WHERE rental_id = ? AND status = 'PAID'`,
    );

    const releaseDoorStmt = db.prepare(
      `UPDATE doors
       SET status = 'AVAILABLE', current_rental_id = NULL, updated_at = ?
       WHERE id = ? AND current_rental_id = ?`,
    );

    const notifications: ExpiredRentalNotification[] = [];

    for (const row of overdueRows) {
      if (cancelRentalStmt.run(row.id, row.rental_status).changes === 0) {
        continue;
      }

      const pickupTimeout = row.rental_status === 'PAID_READY_FOR_PICKUP';
      (pickupTimeout ? refundPaymentStmt : expireUnpaidPaymentStmt).run(row.id);

      const doorReleased = releaseDoorStmt.run(nowIso, row.door_id, row.id).changes === 1;
      const doorStatusAfter: DoorStatus = doorReleased ? 'AVAILABLE' : row.door_status;

      insertDoorEvent({
        doorId: row.door_id,
        rentalId: row.id,
        userId: row.user_id,
        eventType: 'STATUS_CHANGE',
        createdAt: nowIso,
        details: {
          from: row.door_status,
          to: doorStatusAfter,
          reason: pickupTimeout ? 'PICKUP_TIMEOUT' : 'EXPIRED_TTL',
          ...(doorReleased ? {} : { doorReleased: false }),
        },
      });

      notifications.push({
        rentalId: row.id,
        userId: row.user_id,
        lockerId: row.locker_id,
        doorId: row.door_id,
        doorNumber: row.door_number,
        lockState: row.lock_state,
        doorStatus: doorStatusAfter,
        doorReleased,
      });
    }

    return notifications;
  });

  for (const item of expired) {
    if (item.doorReleased) {
      broadcastCatalogStockUpdated({
        lockerId: item.lockerId,
        door: {
          id: item.doorId,
          doorNumber: item.doorNumber,
          status: 'AVAILABLE',
          lockState: item.lockState,
          currentRentalId: null,
          currentOccupantName: null,
          expectedReturnAt: null,
        },
      });
    }

    sendRentalStatusUpdated(item.userId, {
      rentalId: item.rentalId,
      status: 'CANCELLED',
      doorId: item.doorId,
      doorNumber: item.doorNumber,
      doorStatus: item.doorStatus,
      lockState: item.lockState,
    });
  }

  return expired.length;
}

/**
 * Inicia o worker periódico em background a cada 10 segundos.
 */
export function startTtlWorker(intervalMs = 10_000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    try {
      const expiredCount = expireOverdueReservations();
      if (expiredCount > 0) {
        console.log(`[TTL Worker] ${expiredCount} reserva(s) expirada(s) liberada(s).`);
      }
    } catch (error) {
      console.error('[TTL Worker] Erro ao verificar reservas vencidas:', error);
    }
  }, intervalMs);
  workerTimer.unref();
}

/**
 * Encerra o timer periódico de expiração TTL, caso esteja ativo.
 */
export function stopTtlWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}
