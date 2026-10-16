/**
 * Rotina de Expiração Automática de Reserva (TTL - RF16)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Varre o banco SQLite em busca de reservas em `AWAITING_PAYMENT` cujo `reservation_expires_at` já venceu.
 *
 * // TODO: [BE1-06] (Dev 2 - Backend A):
 * 1. Consultar todas as locações em `rentals` com `status = 'AWAITING_PAYMENT'` e `reservation_expires_at < NOW()`.
 * 2. Em transação SQLite (`runImmediateTransaction`):
 *    - Atualizar `rentals` para `status = 'CANCELLED'`, `cancel_reason = 'EXPIRED_TTL'`.
 *    - Atualizar `payments` para `status = 'EXPIRED'`.
 *    - Liberar a porta (`doors.status = 'AVAILABLE'`, `current_rental_id = NULL`).
 *    - Inserir log em `door_events` (`STATUS_CHANGE`).
 * 3. Chamar `broadcastCatalogStockUpdated` e `sendRentalStatusUpdated` do `../ws/broker.js`.
 */
export function expireOverdueReservations(): number {
  // TODO: [BE1-06] Implementar lógica SQL de expiração TTL aqui.
  return 0;
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
}
