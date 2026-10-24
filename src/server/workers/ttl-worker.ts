/**
 * Rotina de Expiração Automática de Reserva (TTL - RF16)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */

import type { DoorStatus, LockState } from '../../shared/types.js';
import { db, insertDoorEvent, runImmediateTransaction } from '../db/connection.js';
import { broadcastCatalogStockUpdated, sendRentalStatusUpdated } from '../ws/broker.js';

interface OverdueReservationRow {
  id: string;
  user_id: string;
  locker_id: string;
  door_id: string;
  door_number: number;
  lock_state: LockState;
  door_status: DoorStatus;
  current_rental_id: string | null;
}

interface ExpiredReservationNotification {
  rentalId: string;
  userId: string;
  lockerId: string;
  doorId: string;
  doorNumber: number;
  lockState: LockState;
}

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Varre o banco SQLite em busca de reservas em `AWAITING_PAYMENT` cujo `reservation_expires_at` já venceu.
 * Executa o cancelamento e a liberação de estoque de forma atômica (`IMMEDIATE`) e dispara eventos WebSocket pós-COMMIT.
 */
export function expireOverdueReservations(referenceNow: Date = new Date()): number {
  const nowIso = referenceNow.toISOString();

  const expiredNotifications = runImmediateTransaction<ExpiredReservationNotification[]>(() => {
    const overdueRows = db
      .prepare(
        `SELECT
           r.id,
           r.user_id,
           r.locker_id,
           r.door_id,
           d.door_number,
           d.lock_state,
           d.status AS door_status,
           d.current_rental_id
         FROM rentals r
         JOIN doors d ON r.door_id = d.id
         WHERE r.status = 'AWAITING_PAYMENT'
           AND r.reservation_expires_at <= ?
         ORDER BY r.reservation_expires_at ASC`,
      )
      .all(nowIso) as OverdueReservationRow[];

    if (overdueRows.length === 0) {
      return [];
    }

    const updateRentalStmt = db.prepare(
      `UPDATE rentals
       SET status = 'CANCELLED', cancel_reason = 'EXPIRED_TTL'
       WHERE id = ? AND status = 'AWAITING_PAYMENT'`,
    );

    const updatePaymentStmt = db.prepare(
      `UPDATE payments
       SET status = 'EXPIRED'
       WHERE rental_id = ? AND status = 'PENDING'`,
    );

    const updateDoorStmt = db.prepare(
      `UPDATE doors
       SET status = 'AVAILABLE', current_rental_id = NULL, updated_at = ?
       WHERE id = ?`,
    );

    const expired: ExpiredReservationNotification[] = [];

    for (const row of overdueRows) {
      const rentalResult = updateRentalStmt.run(row.id);
      if (rentalResult.changes === 0) {
        continue;
      }

      updatePaymentStmt.run(row.id);

      if (row.current_rental_id === row.id || row.door_status === 'RESERVED') {
        updateDoorStmt.run(nowIso, row.door_id);
      }

      insertDoorEvent({
        doorId: row.door_id,
        rentalId: row.id,
        userId: row.user_id,
        eventType: 'STATUS_CHANGE',
        createdAt: nowIso,
        details: {
          from: row.door_status,
          to: 'AVAILABLE',
          reason: 'EXPIRED_TTL',
        },
      });

      expired.push({
        rentalId: row.id,
        userId: row.user_id,
        lockerId: row.locker_id,
        doorId: row.door_id,
        doorNumber: row.door_number,
        lockState: row.lock_state,
      });
    }

    return expired;
  });

  for (const item of expiredNotifications) {
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

    sendRentalStatusUpdated(item.userId, {
      rentalId: item.rentalId,
      status: 'CANCELLED',
      doorId: item.doorId,
      doorNumber: item.doorNumber,
      doorStatus: 'AVAILABLE',
      lockState: item.lockState,
    });
  }

  return expiredNotifications.length;
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
