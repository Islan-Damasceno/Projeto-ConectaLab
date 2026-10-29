import { cleanupTestDb } from './setup-test-db.js';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Fastify, { type FastifyInstance } from 'fastify';
import { db, resetDatabaseWithSeeds } from '../../db/connection.js';
import { verifyAuthToken } from '../../db/auth-helper.js';
import { authRoutes } from '../../routes/auth.routes.js';
import type {
  ApiErrorResponse,
  CancelReason,
  QuickLoginResponse,
  RentalStatus,
} from '../../../shared/types.js';

interface DbUserVerifyRow {
  id: string;
  name: string;
  ra: string;
  email: string;
  role: string;
  created_at: string;
}

function insertRentalForTest(params: {
  id: string;
  userId: string;
  doorId?: string;
  itemId?: string;
  status: RentalStatus;
  reservationExpiresAt: string;
  cancelReason?: CancelReason | null;
  createdAt?: string;
}): void {
  const createdAt = params.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO rentals (
      id, user_id, locker_id, door_id, item_id,
      plan_type, duration_units, total_amount_cents,
      status, cancel_reason, reservation_expires_at, created_at
    ) VALUES (?, ?, 'locker-bloco-b', ?, ?, 'HOURLY', 1, 400, ?, ?, ?, ?)`,
  ).run(
    params.id,
    params.userId,
    params.doorId ?? 'door-b-02',
    params.itemId ?? 'itm-02',
    params.status,
    params.cancelReason ?? null,
    params.reservationExpiresAt,
    createdAt,
  );
}

describe('BE1-02 — POST /api/auth/quick-login (RF01, RNF05)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(authRoutes);
    await app.ready();
    // Aquece o pipeline HTTP in-memory do Fastify antes de aferir latência (< 50ms)
    await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: { name: '', ra: '', email: 'warmup' },
    });
  });

  beforeEach(() => {
    resetDatabaseWithSeeds();
  });

  after(async () => {
    await app.close();
    cleanupTestDb(db);
  });

  it('autentica aluno existente no seed preservando id e role STUDENT com JWT válido e latência < 50ms', async () => {
    const seedRowBefore = db
      .prepare('SELECT id, role, created_at FROM users WHERE id = ?')
      .get('usr-student-01') as { id: string; role: string; created_at: string };

    const startMs = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Lucas Andrade',
        ra: '20261045',
        email: 'lucas.andrade@faculdade.edu.br',
      },
    });
    const elapsedMs = performance.now() - startMs;

    assert.equal(response.statusCode, 200);
    assert.ok(
      elapsedMs < 50,
      `Esperava latência < 50ms no quick-login, mas levou ${elapsedMs.toFixed(2)}ms`,
    );

    const body = response.json() as QuickLoginResponse;
    assert.equal(body.user.id, 'usr-student-01');
    assert.equal(body.user.name, 'Lucas Andrade');
    assert.equal(body.user.ra, '20261045');
    assert.equal(body.user.email, 'lucas.andrade@faculdade.edu.br');
    assert.equal(body.user.role, 'STUDENT');
    assert.equal(body.user.createdAt, seedRowBefore.created_at);
    assert.equal(body.activeRentalId, null);

    const decoded = verifyAuthToken(body.token);
    assert.ok(decoded, 'Token JWT retornado deve ter assinatura HS256 válida');
    assert.equal(decoded.userId, 'usr-student-01');
    assert.equal(decoded.sub, 'usr-student-01');
    assert.equal(decoded.email, 'lucas.andrade@faculdade.edu.br');
    assert.equal(decoded.ra, '20261045');
    assert.equal(decoded.role, 'STUDENT');
  });

  it('realiza cadastro automático (upsert) de novo aluno @aluno.faculdade.edu.br normalizando maiúsculas e espaços', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: '  Camila Ferreira  ',
        ra: '  20268877  ',
        email: '  NOVO.ALUNO@ALUNO.FACULDADE.EDU.BR  ',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as QuickLoginResponse;

    assert.match(body.user.id, /^usr-[a-f0-9]{10}$/);
    assert.equal(body.user.name, 'Camila Ferreira');
    assert.equal(body.user.ra, '20268877');
    assert.equal(body.user.email, 'novo.aluno@aluno.faculdade.edu.br');
    assert.equal(body.user.role, 'STUDENT');
    assert.equal(body.activeRentalId, null);

    const persisted = db
      .prepare(
        'SELECT id, name, ra, email, role, created_at FROM users WHERE id = ?',
      )
      .get(body.user.id) as DbUserVerifyRow | undefined;

    assert.ok(persisted, 'Novo aluno deve estar persistido na tabela users');
    assert.equal(persisted.email, 'novo.aluno@aluno.faculdade.edu.br');
    assert.equal(persisted.name, 'Camila Ferreira');
    assert.equal(persisted.ra, '20268877');
    assert.equal(persisted.role, 'STUDENT');

    // Novo login com o mesmo e-mail deve atualizar nome/RA mantendo o mesmo ID e created_at
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Camila F. Santos',
        ra: '20268878',
        email: 'Novo.Aluno@aluno.faculdade.edu.br',
      },
    });

    assert.equal(secondResponse.statusCode, 200);
    const secondBody = secondResponse.json() as QuickLoginResponse;
    assert.equal(secondBody.user.id, body.user.id);
    assert.equal(secondBody.user.name, 'Camila F. Santos');
    assert.equal(secondBody.user.ra, '20268878');
    assert.equal(secondBody.user.createdAt, persisted.created_at);
  });

  it('recusa com 403 o login rápido de conta ADMIN, sem emitir token nem alterar o cadastro', async () => {
    for (const email of ['mariana.admin@faculdade.edu.br', '  MARIANA.ADMIN@FACULDADE.EDU.BR ']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: { name: 'Quem Souber o E-mail', ra: '00000000', email },
      });

      assert.equal(response.statusCode, 403, `e-mail ${JSON.stringify(email)}`);
      const body = response.json() as ApiErrorResponse & { token?: string };
      assert.equal(body.error, 'ADMIN_QUICK_LOGIN_FORBIDDEN');
      assert.equal(body.token, undefined);
    }

    const adminAfter = db
      .prepare('SELECT name, ra, role FROM users WHERE id = ?')
      .get('usr-admin-01') as Pick<DbUserVerifyRow, 'name' | 'ra' | 'role'>;
    assert.deepEqual(adminAfter, { name: 'Mariana Costa (Admin)', ra: 'ADM001', role: 'ADMIN' });
  });

  it('aceita nome de até 120 e RA de até 30 caracteres e recusa acima disso sem gravar nada', async () => {
    const atLimit = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: { name: 'N'.repeat(120), ra: 'R'.repeat(30), email: 'limite.exato@faculdade.edu.br' },
    });
    assert.equal(atLimit.statusCode, 200);

    const countBefore = (
      db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number }
    ).total;

    const overLimit = [
      { name: 'N'.repeat(121), ra: '20260001', email: 'nome.longo@faculdade.edu.br' },
      { name: 'Ra Longo', ra: 'R'.repeat(31), email: 'ra.longo@faculdade.edu.br' },
      { name: 'Lucas Andrade', ra: 'R'.repeat(200_000), email: 'lucas.andrade@faculdade.edu.br' },
    ];
    for (const payload of overLimit) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/quick-login', payload });
      assert.equal(response.statusCode, 400);
      assert.equal((response.json() as ApiErrorResponse).error, 'INVALID_LOGIN_INPUT');
    }

    const countAfter = (
      db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number }
    ).total;
    assert.equal(countAfter, countBefore);

    const lucas = db.prepare('SELECT ra FROM users WHERE id = ?').get('usr-student-01') as {
      ra: string;
    };
    assert.equal(lucas.ra, '20261045');
  });

  it('aceita e-mail institucional de até 254 caracteres e recusa a partir de 255', async () => {
    const domain = '@faculdade.edu.br';
    const at254 = `${'a'.repeat(254 - domain.length)}${domain}`;
    const at255 = `${'a'.repeat(255 - domain.length)}${domain}`;

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: { name: 'E-mail Longo', ra: '20260002', email: at254 },
    });
    assert.equal(accepted.statusCode, 200);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: { name: 'E-mail Longo Demais', ra: '20260003', email: at255 },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal((rejected.json() as ApiErrorResponse).error, 'INVALID_INSTITUTIONAL_EMAIL');
  });

  it('rejeita HTTP 400 INVALID_INSTITUTIONAL_EMAIL para domínios pessoais, maliciosos ou malformados', async () => {
    const invalidEmails: unknown[] = [
      'lucas.andrade@gmail.com',
      'estudante@hotmail.com',
      'ataque@malicious-faculdade.edu.br',
      'phishing@faculdade.edu.br.evil.com',
      '@faculdade.edu.br',
      '@aluno.faculdade.edu.br',
      '',
      '   ',
      undefined,
      null,
    ];

    const countBefore = (
      db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number }
    ).total;

    for (const badEmail of invalidEmails) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Teste Inválido',
          ra: '20260000',
          email: badEmail,
        },
      });

      assert.equal(
        response.statusCode,
        400,
        `Deveria rejeitar o e-mail inválido: ${String(badEmail)}`,
      );
      const body = response.json() as ApiErrorResponse;
      assert.equal(body.error, 'INVALID_INSTITUTIONAL_EMAIL');
      assert.equal(
        body.message,
        'Use seu e-mail institucional (@faculdade.edu.br ou @aluno.faculdade.edu.br) para acessar os armários do campus.',
      );
    }

    const countAfter = (
      db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number }
    ).total;
    assert.equal(countAfter, countBefore);
  });

  it('rejeita HTTP 400 INVALID_LOGIN_INPUT quando name ou ra estão em branco', async () => {
    const invalidPayloads = [
      { name: '', ra: '20261045', email: 'lucas.andrade@faculdade.edu.br' },
      { name: '    ', ra: '20261045', email: 'lucas.andrade@faculdade.edu.br' },
      { name: 'Lucas Andrade', ra: '', email: 'lucas.andrade@faculdade.edu.br' },
      { name: 'Lucas Andrade', ra: '   ', email: 'lucas.andrade@faculdade.edu.br' },
      { name: '   ', ra: '   ', email: 'lucas.andrade@faculdade.edu.br' },
      { ra: '20261045', email: 'lucas.andrade@faculdade.edu.br' },
      { name: 'Lucas Andrade', email: 'lucas.andrade@faculdade.edu.br' },
    ];

    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload,
      });

      assert.equal(response.statusCode, 400);
      const body = response.json() as ApiErrorResponse;
      assert.equal(body.error, 'INVALID_LOGIN_INPUT');
      assert.equal(body.message, 'Nome completo e RA são obrigatórios.');
    }
  });

  it('retorna activeRentalId para locações em andamento (no prazo) e null para expiradas, concluídas ou canceladas', async () => {
    const futureIso = new Date(Date.now() + 10 * 60_000).toISOString();
    const pastIso = new Date(Date.now() - 10 * 60_000).toISOString();

    const activeStatuses: RentalStatus[] = [
      'AWAITING_PAYMENT',
      'PAID_READY_FOR_PICKUP',
      'IN_USE',
      'AWAITING_RETURN_CLOSE',
    ];

    for (const status of activeStatuses) {
      resetDatabaseWithSeeds();

      const rentalId = `rnt-active-${status.toLowerCase()}`;
      insertRentalForTest({
        id: rentalId,
        userId: 'usr-student-01',
        status,
        // Para AWAITING_PAYMENT precisa estar no futuro; para os demais status ativos mesmo TTL passado continua ativo
        reservationExpiresAt: status === 'AWAITING_PAYMENT' ? futureIso : pastIso,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Lucas Andrade',
          ra: '20261045',
          email: 'lucas.andrade@faculdade.edu.br',
        },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json() as QuickLoginResponse;
      assert.equal(
        body.activeRentalId,
        rentalId,
        `Esperava activeRentalId=${rentalId} para status ${status}`,
      );
    }

    // Caso 1: AWAITING_PAYMENT com TTL já vencido deve retornar null
    resetDatabaseWithSeeds();
    insertRentalForTest({
      id: 'rnt-expired-awaiting',
      userId: 'usr-student-01',
      status: 'AWAITING_PAYMENT',
      reservationExpiresAt: pastIso,
    });

    const expiredRes = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Lucas Andrade',
        ra: '20261045',
        email: 'lucas.andrade@faculdade.edu.br',
      },
    });
    assert.equal(expiredRes.statusCode, 200);
    assert.equal((expiredRes.json() as QuickLoginResponse).activeRentalId, null);

    // Caso 2: Apenas locações COMPLETED e CANCELLED (e outro aluno com locação ativa) deve retornar null
    resetDatabaseWithSeeds();
    insertRentalForTest({
      id: 'rnt-completed-01',
      userId: 'usr-student-01',
      status: 'COMPLETED',
      reservationExpiresAt: futureIso,
      createdAt: '2026-10-24T10:00:00.000Z',
    });
    insertRentalForTest({
      id: 'rnt-cancelled-01',
      userId: 'usr-student-01',
      status: 'CANCELLED',
      cancelReason: 'EXPIRED_TTL',
      reservationExpiresAt: pastIso,
      createdAt: '2026-10-24T11:00:00.000Z',
    });
    insertRentalForTest({
      id: 'rnt-other-student',
      userId: 'usr-student-02',
      doorId: 'door-b-03',
      itemId: 'itm-03',
      status: 'IN_USE',
      reservationExpiresAt: futureIso,
    });

    const finishedRes = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Lucas Andrade',
        ra: '20261045',
        email: 'lucas.andrade@faculdade.edu.br',
      },
    });
    assert.equal(finishedRes.statusCode, 200);
    assert.equal((finishedRes.json() as QuickLoginResponse).activeRentalId, null);

    // Caso 3: Havendo histórico antigo COMPLETED e mais de uma locação ativa, retorna a mais recente (created_at DESC)
    insertRentalForTest({
      id: 'rnt-active-older',
      userId: 'usr-student-01',
      doorId: 'door-b-01',
      itemId: 'itm-01',
      status: 'PAID_READY_FOR_PICKUP',
      reservationExpiresAt: futureIso,
      createdAt: '2026-10-24T12:00:00.000Z',
    });
    insertRentalForTest({
      id: 'rnt-active-newer',
      userId: 'usr-student-01',
      doorId: 'door-b-04',
      itemId: 'itm-04',
      status: 'IN_USE',
      reservationExpiresAt: futureIso,
      createdAt: '2026-10-24T14:00:00.000Z',
    });

    const latestActiveRes = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Lucas Andrade',
        ra: '20261045',
        email: 'lucas.andrade@faculdade.edu.br',
      },
    });
    assert.equal(latestActiveRes.statusCode, 200);
    assert.equal(
      (latestActiveRes.json() as QuickLoginResponse).activeRentalId,
      'rnt-active-newer',
    );
  });
});
