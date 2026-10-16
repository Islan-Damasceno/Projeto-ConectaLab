import type { FastifyInstance } from 'fastify';
import type {
  UnlockRentalResponse,
  ReturnUnlockRentalResponse,
  ApiErrorResponse,
} from '../../shared/types.js';
import { sendDoorUnlockCommand, broadcastCatalogStockUpdated } from '../ws/broker.js';

/**
 * Rotas de Acionamento Físico IoT: Destravamento para Retirada e Devolução (RF06, RF08, RN03, RN04, RNF01, RNF05)
 * Responsável Exclusivo: Dev 3 (Backend B)
 */
export async function unlockRoutes(app: FastifyInstance): Promise<void> {
  void sendDoorUnlockCommand;
  void broadcastCatalogStockUpdated;

  /**
   * POST /api/rentals/:rentalId/unlock — Comando Remoto de Retirada (RF06, RN03, RNF01, RNF05)
   *
   * // TODO: [BE2-03] (Dev 3 - Backend B):
   * 1. Validar segurança (RNF05 e RN03):
   *    - Verificar se a locação pertence ao aluno autenticado (`x-user-id` / Bearer token).
   *    - Verificar se `rental.status === 'PAID_READY_FOR_PICKUP'` (ou `IN_USE` se reabrindo).
   *    - Se estiver `AWAITING_PAYMENT` ou pertencer a outro aluno, retornar `403 Forbidden`.
   * 2. No SQLite:
   *    - Atualizar `doors.lock_state = 'UNLOCKED'`.
   *    - Preencher `rentals.first_unlocked_at = COALESCE(first_unlocked_at, NOW())`.
   *    - Inserir evento `UNLOCK_PICKUP` na tabela `door_events`.
   * 3. Disparar imediatamente (< 500ms) `sendDoorUnlockCommand({ ... actionContext: 'PICKUP', playSoundEffect: true })`.
   */
  app.post<{
    Params: { rentalId: string };
    Reply: UnlockRentalResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/unlock', async (_request, reply) => {
    // TODO: [BE2-03] Implementar validação RN03/RNF05 + envio do comando WebSocket DOOR_UNLOCK_COMMAND.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE2-03]: Implementar POST /api/rentals/:rentalId/unlock',
    });
  });

  /**
   * POST /api/rentals/:rentalId/return-unlock — Comando Remoto de Devolução na Porta de Origem (RF08, RN04)
   *
   * // TODO: [BE2-04] (Dev 3 - Backend B):
   * 1. Validar que o aluno é o titular e que `rental.status === 'IN_USE'`.
   * 2. Atualizar `rentals.status = 'AWAITING_RETURN_CLOSE'` e `doors.lock_state = 'UNLOCKED'`.
   * 3. Inserir evento `UNLOCK_RETURN` em `door_events`.
   * 4. Disparar `sendDoorUnlockCommand({ ... actionContext: 'RETURN', playSoundEffect: true })` para a mesma porta de origem (RN04).
   */
  app.post<{
    Params: { rentalId: string };
    Reply: ReturnUnlockRentalResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/return-unlock', async (_request, reply) => {
    // TODO: [BE2-04] Implementar abertura para devolução na porta de origem.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE2-04]: Implementar POST /api/rentals/:rentalId/return-unlock',
    });
  });
}
