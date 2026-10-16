import type { FastifyInstance } from 'fastify';
import type {
  ListLockersResponse,
  LockerCatalogResponse,
  ApiErrorResponse,
} from '../../shared/types.js';

/**
 * Rotas de Armários e Catálogo por Ponto de Retirada (RF02, RF11, RF14)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function lockersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/lockers
   *
   * // TODO: [BE1-03] (Dev 2 - Backend A):
   * - Listar todos os armários da tabela `lockers` com contagem de portas totais e portas `AVAILABLE`.
   */
  app.get<{
    Reply: ListLockersResponse;
  }>('/api/lockers', async (_request, reply) => {
    // TODO: [BE1-03] Implementar query SQLite na tabela `lockers` + `doors`.
    return reply.status(200).send({ lockers: [] });
  });

  /**
   * GET /api/lockers/:lockerId/catalog
   *
   * // TODO: [BE1-03] (Dev 2 - Backend A):
   * - Buscar o armário pelo `lockerId` (retornar 404 se não existir).
   * - Fazer JOIN entre `doors` e `items` (e `rentals`/`users` para ocupante atual) ordenado por `door_number ASC`.
   */
  app.get<{
    Params: { lockerId: string };
    Reply: LockerCatalogResponse | ApiErrorResponse;
  }>('/api/lockers/:lockerId/catalog', async (_request, reply) => {
    // TODO: [BE1-03] Implementar query SQLite do catálogo por armário.
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'TODO [BE1-03]: Implementar GET /api/lockers/:lockerId/catalog',
    });
  });
}
