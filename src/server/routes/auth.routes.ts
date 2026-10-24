import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  QuickLoginRequest,
  QuickLoginResponse,
  ApiErrorResponse,
  User,
  UserRole,
} from '../../shared/types.js';
import { db, runImmediateTransaction } from '../db/connection.js';
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

interface DbActiveRentalRow {
  id: string;
}

/**
 * Rotas de Autenticação Institucional Rápida (RF01, RNF05)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/auth/quick-login
   *
   * 1. Valida o domínio institucional (`@faculdade.edu.br` ou `@aluno.faculdade.edu.br`) e campos obrigatórios (`name`, `ra`).
   * 2. Expira reservas com TTL vencido antes de consultar locações ativas.
   * 3. Realiza Upsert atômico na tabela `users` preservando `id`, `role` e `created_at` quando já existente.
   * 4. Consulta locação ativa do usuário e retorna `QuickLoginResponse` com token JWT HS256 assinado.
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

    expireOverdueReservations();

    const nowIso = new Date().toISOString();

    const { user, activeRentalId } = runImmediateTransaction(() => {
      const existingUser = db
        .prepare(
          'SELECT id, name, ra, email, role, created_at FROM users WHERE email = ?',
        )
        .get(normalizedEmail) as DbUserRow | undefined;

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

      const activeRental = db
        .prepare(
          `SELECT id
           FROM rentals
           WHERE user_id = ?
             AND status IN ('AWAITING_PAYMENT', 'PAID_READY_FOR_PICKUP', 'IN_USE', 'AWAITING_RETURN_CLOSE')
             AND (status != 'AWAITING_PAYMENT' OR reservation_expires_at > ?)
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(resolvedUser.id, nowIso) as DbActiveRentalRow | undefined;

      return {
        user: resolvedUser,
        activeRentalId: activeRental?.id ?? null,
      };
    });

    const token = signAuthToken(user);

    return reply.status(200).send({
      token,
      user,
      activeRentalId,
    });
  });
}
