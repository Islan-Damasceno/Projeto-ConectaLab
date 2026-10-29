import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  QuickLoginRequest,
  QuickLoginResponse,
  ApiErrorResponse,
  User,
  UserRole,
} from '../../shared/types.js';
import { db, findActiveRentalId, runImmediateTransaction } from '../db/connection.js';
import { isValidInstitutionalEmail, signAuthToken } from '../db/auth-helper.js';
import { expireOverdueReservations } from '../workers/ttl-worker.js';

interface DbUserRow {
  id: string;
  name: string;
  ra: string;
  email: string;
  role: UserRole;
  created_at: string;
}

const MAX_NAME_LENGTH = 120;
const MAX_RA_LENGTH = 30;

/**
 * Rotas de Autenticação Institucional Rápida (RF01, RNF05)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/auth/quick-login
   *
   * 1. Valida o domínio institucional (`@faculdade.edu.br` ou `@aluno.faculdade.edu.br`) e campos obrigatórios (`name`, `ra`) com limite de tamanho.
   * 2. Expira reservas com TTL vencido antes de consultar locações ativas.
   * 3. Recusa contas ADMIN (403): o login rápido é só para alunos e não tem senha.
   * 4. Realiza Upsert atômico na tabela `users` preservando `id`, `role` e `created_at` quando já existente.
   * 5. Consulta locação ativa do usuário e retorna `QuickLoginResponse` com token JWT HS256 assinado.
   */
  app.post<{
    Body: QuickLoginRequest;
    Reply: QuickLoginResponse | ApiErrorResponse;
  }>('/api/auth/quick-login', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<QuickLoginRequest>;
    const { name, ra, email } = body;

    if (typeof email !== 'string' || !isValidInstitutionalEmail(email)) {
      return reply.status(400).send({
        error: 'INVALID_INSTITUTIONAL_EMAIL',
        message:
          'Use seu e-mail institucional (@faculdade.edu.br ou @aluno.faculdade.edu.br) para acessar os armários do campus.',
      });
    }

    if (
      typeof name !== 'string' ||
      typeof ra !== 'string' ||
      name.trim().length === 0 ||
      ra.trim().length === 0
    ) {
      return reply.status(400).send({
        error: 'INVALID_LOGIN_INPUT',
        message: 'Nome completo e RA são obrigatórios.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedRa = ra.trim();

    if (trimmedName.length > MAX_NAME_LENGTH || trimmedRa.length > MAX_RA_LENGTH) {
      return reply.status(400).send({
        error: 'INVALID_LOGIN_INPUT',
        message: `Nome deve ter até ${MAX_NAME_LENGTH} caracteres e RA até ${MAX_RA_LENGTH}.`,
      });
    }

    expireOverdueReservations();

    const nowIso = new Date().toISOString();

    type LoginTxResult =
      | { kind: 'ADMIN_FORBIDDEN' }
      | { kind: 'OK'; user: User; activeRentalId: string | null };

    const outcome = runImmediateTransaction<LoginTxResult>(() => {
      const existingUser = db
        .prepare(
          'SELECT id, name, ra, email, role, created_at FROM users WHERE email = ?',
        )
        .get(normalizedEmail) as DbUserRow | undefined;

      // O login rápido não tem senha: liberar uma conta ADMIN aqui daria o painel a quem souber o e-mail
      if (existingUser?.role === 'ADMIN') {
        return { kind: 'ADMIN_FORBIDDEN' };
      }

      let resolvedUser: User;

      if (existingUser) {
        db.prepare('UPDATE users SET name = ?, ra = ? WHERE id = ?').run(
          trimmedName,
          trimmedRa,
          existingUser.id,
        );

        resolvedUser = {
          id: existingUser.id,
          name: trimmedName,
          ra: trimmedRa,
          email: existingUser.email,
          role: existingUser.role,
          createdAt: existingUser.created_at,
        };
      } else {
        const newUserId =
          'usr-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);

        db.prepare(
          `INSERT INTO users (id, name, ra, email, role, created_at)
           VALUES (?, ?, ?, ?, 'STUDENT', ?)`,
        ).run(newUserId, trimmedName, trimmedRa, normalizedEmail, nowIso);

        resolvedUser = {
          id: newUserId,
          name: trimmedName,
          ra: trimmedRa,
          email: normalizedEmail,
          role: 'STUDENT',
          createdAt: nowIso,
        };
      }

      return {
        kind: 'OK',
        user: resolvedUser,
        activeRentalId: findActiveRentalId(resolvedUser.id, nowIso),
      };
    });

    if (outcome.kind === 'ADMIN_FORBIDDEN') {
      return reply.status(403).send({
        error: 'ADMIN_QUICK_LOGIN_FORBIDDEN',
        message: 'Contas administrativas não usam o login rápido de aluno.',
      });
    }

    const token = signAuthToken(outcome.user);

    return reply.status(200).send({
      token,
      user: outcome.user,
      activeRentalId: outcome.activeRentalId,
    });
  });
}
