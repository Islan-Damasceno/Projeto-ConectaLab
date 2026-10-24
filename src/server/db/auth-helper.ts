import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorResponse, User, UserRole } from '../../shared/types.js';
import { db } from './connection.js';

/**
 * Domínios institucionais aceitos pelo ConectaLab (SPEC.md RF01 & ADT.md 4.2.1):
 * - @faculdade.edu.br
 * - @aluno.faculdade.edu.br
 */
export const INSTITUTIONAL_EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@(?:aluno\.)?faculdade\.edu\.br$/i;

const JWT_SECRET =
  process.env.CONECTALAB_JWT_SECRET ?? 'conectalab-institutional-secret-v1';

interface JwtPayload {
  sub: string;
  userId: string;
  email: string;
  ra: string;
  role: UserRole;
  iat: number;
}

interface DbUserRow {
  id: string;
  name: string;
  ra: string;
  email: string;
  role: UserRole;
  created_at: string;
}

/**
 * Valida se o e-mail pertence ao domínio institucional da faculdade (RF01).
 */
export function isValidInstitutionalEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  return INSTITUTIONAL_EMAIL_REGEX.test(email.trim());
}

/**
 * Assina um token JWT HS256 compacto sem dependências externas (RNF05).
 */
export function signAuthToken(user: User): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const payloadObj: JwtPayload = {
    sub: user.id,
    userId: user.id,
    email: user.email,
    ra: user.ra,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
  };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verifica a integridade criptográfica de um token JWT HS256.
 * Retorna o `JwtPayload` se válido ou `null` se adulterado/malformado.
 */
export function verifyAuthToken(token: string): JwtPayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const actualBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    actualBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8'),
    ) as Partial<JwtPayload>;
    if (!parsed.userId || typeof parsed.userId !== 'string') {
      return null;
    }
    return parsed as JwtPayload;
  } catch {
    return null;
  }
}

export type AuthResolutionResult =
  | { ok: true; user: User }
  | { ok: false; statusCode: 401; body: ApiErrorResponse };

/**
 * Resolve o usuário autenticado a partir de `Authorization: Bearer <token>`
 * e/ou header `x-user-id` (conforme ADT.md Seção 4.1 e RNF05).
 *
 * Regras de Segurança (RNF05):
 * 1. Se `Authorization` for enviado, valida obrigatoriamente a assinatura HS256.
 * 2. Se ambos `Authorization` e `x-user-id` forem enviados, exige que apontem para o mesmo `userId` (anti-spoofing).
 * 3. Se apenas `x-user-id` for enviado (suporte de integração ADT 4.1/4.2.5), valida o usuário na tabela `users`.
 * 4. Confirma sempre que o registro existe no SQLite.
 */
export function resolveAuthenticatedUser(request: FastifyRequest): AuthResolutionResult {
  const authHeader = request.headers.authorization;
  const rawXUserId = request.headers['x-user-id'];
  const xUserId =
    typeof rawXUserId === 'string' && rawXUserId.trim().length > 0
      ? rawXUserId.trim()
      : undefined;

  let resolvedUserId: string | undefined;

  if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!match) {
      return {
        ok: false,
        statusCode: 401,
        body: {
          error: 'INVALID_AUTH_HEADER',
          message: 'Formato do cabeçalho Authorization inválido. Use Bearer <token>.',
        },
      };
    }

    const verified = verifyAuthToken(match[1]);
    if (!verified) {
      return {
        ok: false,
        statusCode: 401,
        body: {
          error: 'INVALID_TOKEN',
          message: 'Token de sessão inválido ou adulterado. Faça login novamente.',
        },
      };
    }

    if (xUserId && xUserId !== verified.userId) {
      return {
        ok: false,
        statusCode: 401,
        body: {
          error: 'TOKEN_USER_MISMATCH',
          message: 'Conflito de identidade entre o token Bearer e o cabeçalho x-user-id.',
        },
      };
    }

    resolvedUserId = verified.userId;
  } else if (xUserId) {
    resolvedUserId = xUserId;
  }

  if (!resolvedUserId) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: 'UNAUTHORIZED',
        message: 'Autenticação necessária. Faça login institucional para continuar.',
      },
    };
  }

  const row = db
    .prepare(
      'SELECT id, name, ra, email, role, created_at FROM users WHERE id = ?',
    )
    .get(resolvedUserId) as DbUserRow | undefined;

  if (!row) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: 'USER_NOT_FOUND',
        message: 'Sessão inválida: usuário não encontrado no cadastro institucional.',
      },
    };
  }

  return {
    ok: true,
    user: {
      id: row.id,
      name: row.name,
      ra: row.ra,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    },
  };
}

/**
 * Helper prático para rotas Fastify protegidas: retorna `User` ou já envia `401` no `reply`.
 */
export function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): User | null {
  const result = resolveAuthenticatedUser(request);
  if (!result.ok) {
    void reply.status(result.statusCode).send(result.body);
    return null;
  }
  return result.user;
}
