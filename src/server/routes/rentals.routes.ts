import type { FastifyInstance } from 'fastify';
import type {
  CreateRentalRequest,
  CreateRentalResponse,
  GetRentalDetailsResponse,
  ExtendRentalRequest,
  ExtendRentalResponse,
  ReportIssueRequest,
  ReportIssueResponse,
  ApiErrorResponse,
} from '../../shared/types.js';
import { broadcastCatalogStockUpdated, sendRentalStatusUpdated } from '../ws/broker.js';

/**
 * Rotas Comerciais de Locação: Reserva, Consulta, Prorrogação e Vistoria (RF03, RF04, RF07, RF09, RF10)
 * Responsável Exclusivo: Dev 2 (Backend A)
 *
 * NOTA DE ARQUITETURA:
 * Os comandos físicos de abertura (`/unlock` e `/return-unlock`) ficam em `unlock.routes.ts` (Dev 3)
 * para garantir zero conflito de Git entre Dev 2 e Dev 3.
 */
export async function rentalsRoutes(app: FastifyInstance): Promise<void> {
  // Referência explícita aos helpers do Broker WS para o Dev 2 utilizar após os commits SQLite:
  void broadcastCatalogStockUpdated;
  void sendRentalStatusUpdated;

  /**
   * POST /api/rentals — Criação de Reserva Antecipada com Bloqueio Atômico (RF03, RF04, RN02)
   *
   * // TODO: [BE1-04] (Dev 2 - Backend A):
   * 1. Executar dentro de `runImmediateTransaction(() => { ... })` (`../db/connection.js`).
   * 2. Verificar se a porta está `AVAILABLE`. Se não estiver, retornar `409 Conflict` (`DOOR_NOT_AVAILABLE` - RN02).
   * 3. Calcular `totalAmountCents` com base em `planType` (`HOURLY` ou `DAILY`) e `durationUnits` (RF03).
   * 4. Inserir em `rentals` (`status = 'AWAITING_PAYMENT'`, `reservation_expires_at = +10 min`).
   * 5. Inserir em `payments` (`status = 'PENDING'`, `pix_copy_paste`).
   * 6. Atualizar `doors` (`status = 'RESERVED'`, `current_rental_id = rental.id`).
   * 7. Fora da transação, chamar `broadcastCatalogStockUpdated(...)`.
   */
  app.post<{
    Body: CreateRentalRequest;
    Reply: CreateRentalResponse | ApiErrorResponse;
  }>('/api/rentals', async (_request, reply) => {
    // TODO: [BE1-04] Implementar reserva atômica no SQLite + disparo WS.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-04]: Implementar POST /api/rentals',
    });
  });

  /**
   * GET /api/rentals/:rentalId — Painel de Locação Ativa (RF07)
   *
   * // TODO: [BE1-04] (Dev 2 - Backend A):
   * - Buscar a locação com JOIN em `doors`, `items`, `lockers` e `payments`.
   */
  app.get<{
    Params: { rentalId: string };
    Reply: GetRentalDetailsResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId', async (_request, reply) => {
    // TODO: [BE1-04] Implementar consulta de locação por ID.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-04]: Implementar GET /api/rentals/:rentalId',
    });
  });

  /**
   * POST /api/rentals/:rentalId/extend — Prorrogação de Horário (RF09 - Extra)
   *
   * // TODO: [BE1-05] (Dev 2 - Backend A):
   * - Validar que a locação está `IN_USE`.
   * - Somar o tempo adicional (`+1h` ou `+1 dia`) ao `expected_return_at` e atualizar `total_amount_cents`.
   * - Notificar o aluno via `sendRentalStatusUpdated(...)`.
   */
  app.post<{
    Params: { rentalId: string };
    Body: ExtendRentalRequest;
    Reply: ExtendRentalResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/extend', async (_request, reply) => {
    // TODO: [BE1-05] Implementar prorrogação de horário (RF09).
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-05]: Implementar POST /api/rentals/:rentalId/extend',
    });
  });

  /**
   * POST /api/rentals/:rentalId/report-issue — Reporte de Problema na Vistoria de 2 min (RF10 - Extra)
   *
   * // TODO: [BE1-05] (Dev 2 - Backend A):
   * - Verificar se `NOW() - first_unlocked_at <= 120 segundos`.
   * - Cancelar a locação (`status = 'CANCELLED'`, `cancel_reason = 'ISSUE_REPORTED'`).
   * - Estornar o pagamento mock (`payments.status = 'REFUNDED'`).
   * - Mudar a porta para `status = 'MAINTENANCE'` e notificar via `broadcastCatalogStockUpdated(...)`.
   */
  app.post<{
    Params: { rentalId: string };
    Body: ReportIssueRequest;
    Reply: ReportIssueResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/report-issue', async (_request, reply) => {
    // TODO: [BE1-05] Implementar reporte de problema na vistoria (RF10).
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-05]: Implementar POST /api/rentals/:rentalId/report-issue',
    });
  });
}
