import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorResponse, User, UserRole } from '../../shared/types.js';
import { db, getOrCreateLocalSecret } from './connection.js';

/**
 * Domínios institucionais aceitos pelo ConectaLab (SPEC.md RF01 & ADT.md 4.2.1):
 * - @faculdade.edu.br
 * - @aluno.faculdade.edu.br
 */
export const INSTITUTIONAL_EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@(?:aluno\.)?faculdade\.edu\.br$/i;

const MAX_EMAIL_LENGTH = 254; // limite de endereço da RFC 5321

const MIN_ENV_SECRET_LENGTH = 32;
const ENV_JWT_SECRET = process.env.CONECTALAB_JWT_SECRET?.trim() || null;
if (ENV_JWT_SECRET !== null && ENV_JWT_SECRET.length < MIN_ENV_SECRET_LENGTH) {
  throw new Error(
    `CONECTALAB_JWT_SECRET precisa ter pelo menos ${MIN_ENV_SECRET_LENGTH} caracteres.`,
  );
}

let jwtSecret: string | null = ENV_JWT_SECRET;

/**
 * Segredo HS256: CONECTALAB_JWT_SECRET quando definido; senão, um segredo aleatório desta
 * instalação guardado no SQLite. Nunca um valor fixo no código, porque o repositório é público.
 */
function getJwtSecret(): string {
  jwtSecret ??= getOrCreateLocalSecret('jwt_hs256_secret');
  return jwtSecret;
}

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
  const trimmed = email.trim();
  return trimmed.length <= MAX_EMAIL_LENGTH && INSTITUTIONAL_EMAIL_REGEX.test(trimmed);
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
    .createHmac('sha256', getJwtSecret())
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
    .createHmac('sha256', getJwtSecret())
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
 * Resolve o usuário autenticado a partir de `Authorization: Bearer <token>` (RNF05).
 *
 * Regras de Segurança (RNF05):
 * 1. O token Bearer é obrigatório e sua assinatura HS256 é sempre validada.
 * 2. `x-user-id` é opcional e só serve como conferência: se vier junto, precisa apontar para o
 *    mesmo `userId` do token (anti-spoofing). Sozinho, não autentica ninguém, porque qualquer
 *    cliente pode escrever qualquer valor nele.
 * 3. Confirma sempre que o registro existe no SQLite.
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
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: 'BEARER_TOKEN_REQUIRED',
        message:
          'Envie o token de sessão no cabeçalho Authorization: Bearer <token>. O cabeçalho x-user-id sozinho não autentica.',
      },
    };
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
