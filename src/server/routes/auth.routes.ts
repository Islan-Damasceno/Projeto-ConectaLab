import type { FastifyInstance } from 'fastify';
import type {
  QuickLoginRequest,
  QuickLoginResponse,
  ApiErrorResponse,
} from '../../shared/types.js';

/**
 * Rotas de Autenticação Institucional Rápida (RF01)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/auth/quick-login
   *
   * // TODO: [BE1-02] (Dev 2 - Backend A):
   * 1. Validar se `email` pertence ao domínio `@faculdade.edu.br` ou `@aluno.faculdade.edu.br` (RF01).
   *    - Se inválido, retornar `reply.status(400).send({ error: 'INVALID_INSTITUTIONAL_EMAIL', message: '...' })`.
   * 2. Fazer Upsert na tabela `users` do SQLite (`db` de `../db/connection.js`).
   * 3. Consultar se o aluno possui locação em andamento (`AWAITING_PAYMENT`, `PAID_READY_FOR_PICKUP`, `IN_USE`, `AWAITING_RETURN_CLOSE`).
   * 4. Retornar `QuickLoginResponse` com `token`, `user` e `activeRentalId`.
   */
  app.post<{
    Body: QuickLoginRequest;
    Reply: QuickLoginResponse | ApiErrorResponse;
  }>('/api/auth/quick-login', async (request, reply) => {
    // TODO: [BE1-02] Substituir stub abaixo pela implementação com SQLite.
    const { name, ra, email } = request.body;
    return reply.status(200).send({
      token: `mock-jwt-${ra}`,
      user: {
        id: 'usr-student-01',
        name,
        ra,
        email,
        role: 'STUDENT',
      },
      activeRentalId: null,
    });
  });
}
