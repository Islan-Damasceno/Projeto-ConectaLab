import type { FastifyInstance } from 'fastify';
import type {
  PixMockWebhookRequest,
  PixMockWebhookResponse,
  ApiErrorResponse,
} from '../../shared/types.js';
import { broadcastCatalogStockUpdated, sendRentalStatusUpdated } from '../ws/broker.js';

/**
 * Rota de Checkout PIX Simulado / Webhook Interno (RF05, RN03)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  void broadcastCatalogStockUpdated;
  void sendRentalStatusUpdated;

  /**
   * POST /api/payments/pix-mock-webhook
   *
   * // TODO: [BE1-05] (Dev 2 - Backend A):
   * 1. Em transação SQLite (`runImmediateTransaction`):
   *    - Buscar locação por `rentalId` e validar que está em `AWAITING_PAYMENT`.
   *    - Atualizar `payments` para `status = 'PAID'`, `paid_at = NOW()`.
   *    - Atualizar `rentals` para `status = 'PAID_READY_FOR_PICKUP'`, `paid_at = NOW()`.
   *    - Atualizar `doors` para `status = 'AWAITING_PICKUP'`.
   * 2. Chamar `sendRentalStatusUpdated(userId, ...)` e `broadcastCatalogStockUpdated(...)`.
   * 3. Retornar `PixMockWebhookResponse` com `canUnlock: true`.
   */
  app.post<{
    Body: PixMockWebhookRequest;
    Reply: PixMockWebhookResponse | ApiErrorResponse;
  }>('/api/payments/pix-mock-webhook', async (_request, reply) => {
    // TODO: [BE1-05] Implementar aprovação do PIX Mock no SQLite + notificação WS.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-05]: Implementar POST /api/payments/pix-mock-webhook',
    });
  });
}
