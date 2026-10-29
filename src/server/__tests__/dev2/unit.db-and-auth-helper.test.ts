import { cleanupTestDb, ACTIVE_TEST_DB_PATH } from './setup-test-db.js';
import crypto from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  db,
  DB_FILE_PATH,
  findActiveRentalId,
  initDatabase,
  insertDoorEvent,
  resetDatabaseWithSeeds,
  runImmediateTransaction,
} from '../../db/connection.js';
import {
  isValidInstitutionalEmail,
  requireAuthenticatedUser,
  signAuthToken,
  verifyAuthToken,
} from '../../db/auth-helper.js';

describe('BE1-01 — Persistência SQLite (WAL Mode), Constraints e Auth Helper', () => {
  beforeEach(() => {
    resetDatabaseWithSeeds();
  });

  after(() => {
    cleanupTestDb(db);
  });

  it('isola o banco de teste via CONECTALAB_DB_PATH em modo WAL e foreign_keys = ON', () => {
    assert.equal(DB_FILE_PATH, ACTIVE_TEST_DB_PATH);
    assert.ok(!DB_FILE_PATH.endsWith('data\\conectalab.db'));
    assert.ok(!DB_FILE_PATH.endsWith('data/conectalab.db'));

    const journalRow = db.pragma('journal_mode', { simple: true }) as string;
    const fkEnabled = db.pragma('foreign_keys', { simple: true }) as number;

    assert.equal(journalRow.toLowerCase(), 'wal');
    assert.equal(fkEnabled, 1);
  });

  it('carrega os seeds iniciais com 2 armários, 6 itens, 6 portas 1:1 (RN01) e 3 usuários', () => {
    initDatabase();

    const lockersCount = (
      db.prepare('SELECT COUNT(*) AS count FROM lockers').get() as { count: number }
    ).count;
    const itemsCount = (
      db.prepare('SELECT COUNT(*) AS count FROM items').get() as { count: number }
    ).count;
    const doorsCount = (
      db.prepare('SELECT COUNT(*) AS count FROM doors').get() as { count: number }
    ).count;
    const usersCount = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;

    assert.equal(lockersCount, 2);
    assert.equal(itemsCount, 6);
    assert.equal(doorsCount, 6);
    assert.equal(usersCount, 3);
  });

  it('impõe vínculo 1:1 estrito entre porta e item via UNIQUE constraint (RN01)', () => {
    assert.throws(() => {
      db.prepare(
        `INSERT INTO doors (id, locker_id, door_number, item_id, status, lock_state)
         VALUES ('door-dup-item', 'locker-bloco-b', 99, 'itm-01', 'AVAILABLE', 'LOCKED')`,
      ).run();
    }, /UNIQUE constraint failed: doors\.item_id/);
  });

  it('impõe constraints CHECK nas máquinas de estado do SQLite', () => {
    assert.throws(() => {
      db.prepare(`UPDATE doors SET status = 'INVALID_STATE' WHERE id = 'door-b-01'`).run();
    }, /CHECK constraint failed/);

    assert.throws(() => {
      db.prepare(`UPDATE doors SET lock_state = 'HALF_OPEN' WHERE id = 'door-b-01'`).run();
    }, /CHECK constraint failed/);
  });

  it('executa rollback atômico completo quando runImmediateTransaction lança erro', () => {
    assert.throws(() => {
      runImmediateTransaction(() => {
        db.prepare(`UPDATE doors SET status = 'RESERVED' WHERE id = 'door-b-01'`).run();
        throw new Error('Falha simulada no meio da transação');
      });
    }, /Falha simulada/);

    const door = db
      .prepare(`SELECT status FROM doors WHERE id = 'door-b-01'`)
      .get() as { status: string };
    assert.equal(door.status, 'AVAILABLE');
  });

  it('registra eventos em door_events via insertDoorEvent e limpa sequência no reset', () => {
    const id1 = insertDoorEvent({
      doorId: 'door-b-01',
      userId: 'usr-student-01',
      eventType: 'STATUS_CHANGE',
      details: { from: 'AVAILABLE', to: 'RESERVED' },
    });
    assert.equal(id1, 1);

    resetDatabaseWithSeeds();

    const countAfterReset = (
      db.prepare('SELECT COUNT(*) AS count FROM door_events').get() as { count: number }
    ).count;
    assert.equal(countAfterReset, 0);

    const idAfterReset = insertDoorEvent({
      doorId: 'door-b-02',
      eventType: 'MASTER_UNLOCK',
    });
    assert.equal(idAfterReset, 1);
  });

  it('findActiveRentalId considera ativa só a reserva no prazo e as fases pagas, e devolve a mais recente', () => {
    const nowIso = '2026-10-24T21:00:00.000Z';
    const insert = db.prepare(
      `INSERT INTO rentals (
         id, user_id, locker_id, door_id, item_id, plan_type, duration_units, total_amount_cents,
         status, reservation_expires_at, created_at
       ) VALUES (?, 'usr-student-01', 'locker-bloco-b', 'door-b-01', 'itm-01', 'HOURLY', 1, 200, ?, ?, ?)`,
    );

    // Reserva vencida que nenhuma varredura TTL limpou ainda não conta como ativa
    insert.run('rnt-vencida', 'AWAITING_PAYMENT', '2026-10-24T20:59:59.999Z', '2026-10-24T20:50:00.000Z');
    insert.run('rnt-concluida', 'COMPLETED', '2026-10-24T22:00:00.000Z', '2026-10-24T20:51:00.000Z');
    insert.run('rnt-cancelada', 'CANCELLED', '2026-10-24T22:00:00.000Z', '2026-10-24T20:52:00.000Z');
    assert.equal(findActiveRentalId('usr-student-01', nowIso), null);

    // Fases pagas continuam ativas mesmo com reservation_expires_at no passado
    insert.run('rnt-em-uso', 'IN_USE', '2026-10-24T20:00:00.000Z', '2026-10-24T20:53:00.000Z');
    assert.equal(findActiveRentalId('usr-student-01', nowIso), 'rnt-em-uso');

    insert.run('rnt-no-prazo', 'AWAITING_PAYMENT', '2026-10-24T21:00:00.001Z', '2026-10-24T20:54:00.000Z');
    assert.equal(findActiveRentalId('usr-student-01', nowIso), 'rnt-no-prazo');
    assert.equal(findActiveRentalId('usr-student-02', nowIso), null);
  });

  it('valida domínios institucionais corretamente (RF01)', () => {
    assert.equal(isValidInstitutionalEmail('lucas.andrade@faculdade.edu.br'), true);
    assert.equal(isValidInstitutionalEmail('BEATRIZ.SILVA@ALUNO.FACULDADE.EDU.BR'), true);
    assert.equal(isValidInstitutionalEmail('  aluno_01+lab@faculdade.edu.br  '), true);

    assert.equal(isValidInstitutionalEmail('lucas@gmail.com'), false);
    assert.equal(isValidInstitutionalEmail('@faculdade.edu.br'), false);
    assert.equal(isValidInstitutionalEmail('lucas@fake-faculdade.edu.br'), false);
    assert.equal(isValidInstitutionalEmail('lucas@faculdade.edu.br.attacker.com'), false);
    assert.equal(isValidInstitutionalEmail(''), false);
  });

  it('assina, verifica JWT HS256 e bloqueia adulteração e spoofing entre Bearer e x-user-id (RNF05)', async () => {
    const tokenLucas = signAuthToken({
      id: 'usr-student-01',
      name: 'Lucas Andrade',
      ra: '20261045',
      email: 'lucas.andrade@faculdade.edu.br',
      role: 'STUDENT',
    });

    const verified = verifyAuthToken(tokenLucas);
    assert.ok(verified);
    assert.equal(verified.userId, 'usr-student-01');

    // Adulterar payload invalida a assinatura HMAC
    const [h, , s] = tokenLucas.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'usr-admin-01', userId: 'usr-admin-01', role: 'ADMIN' }),
    ).toString('base64url');
    assert.equal(verifyAuthToken(`${h}.${forgedPayload}.${s}`), null);

    // Testa resolução via Fastify inject
    const app = Fastify({ logger: false });
    app.get('/api/test-whoami', async (req, reply) => {
      const user = requireAuthenticatedUser(req, reply);
      if (!user) return;
      return { user };
    });
    await app.ready();

    try {
      // 1. Sem credenciais -> 401
      const resNoAuth = await app.inject({ method: 'GET', url: '/api/test-whoami' });
      assert.equal(resNoAuth.statusCode, 401);

      // 2. Com Bearer válido -> 200
      const resBearer = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { authorization: `Bearer ${tokenLucas}` },
      });
      assert.equal(resBearer.statusCode, 200);
      assert.equal(resBearer.json().user.id, 'usr-student-01');

      // 3. Spoofing: Bearer do Lucas + x-user-id da Beatriz -> 401 TOKEN_USER_MISMATCH
      const resSpoof = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: {
          authorization: `Bearer ${tokenLucas}`,
          'x-user-id': 'usr-student-02',
        },
      });
      assert.equal(resSpoof.statusCode, 401);
      assert.equal(resSpoof.json().error, 'TOKEN_USER_MISMATCH');

      // 4. Apenas x-user-id, sem token -> 401 (o header sozinho não autentica ninguém)
      const resHeaderOnly = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { 'x-user-id': 'usr-student-02' },
      });
      assert.equal(resHeaderOnly.statusCode, 401);
      assert.equal(resHeaderOnly.json().error, 'BEARER_TOKEN_REQUIRED');

      const resAdminHeaderOnly = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { 'x-user-id': 'usr-admin-01' },
      });
      assert.equal(resAdminHeaderOnly.statusCode, 401);
      assert.equal(resAdminHeaderOnly.json().error, 'BEARER_TOKEN_REQUIRED');

      // 5. Bearer válido + x-user-id do mesmo usuário (o que src/client/lib/api.ts envia) -> 200
      const resBoth = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: {
          authorization: `Bearer ${tokenLucas}`,
          'x-user-id': 'usr-student-01',
        },
      });
      assert.equal(resBoth.statusCode, 200);
      assert.equal(resBoth.json().user.id, 'usr-student-01');

      // 6. Token íntegro de um usuário que não existe mais no banco -> 401 USER_NOT_FOUND
      const ghostToken = signAuthToken({
        id: 'usr-nao-existe',
        name: 'Usuário Removido',
        ra: '00000000',
        email: 'removido@faculdade.edu.br',
        role: 'STUDENT',
      });
      const resGhost = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { authorization: `Bearer ${ghostToken}` },
      });
      assert.equal(resGhost.statusCode, 401);
      assert.equal(resGhost.json().error, 'USER_NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('rejeita token assinado com o segredo padrão antigo, que estava publicado no repositório', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'usr-admin-01',
        userId: 'usr-admin-01',
        email: 'mariana.admin@faculdade.edu.br',
        ra: 'ADM001',
        role: 'ADMIN',
        iat: 1793299386,
      }),
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', 'conectalab-institutional-secret-v1')
      .update(`${header}.${payload}`)
      .digest('base64url');

    assert.equal(verifyAuthToken(`${header}.${payload}.${signature}`), null);
  });
});
