import { cleanupTestDb, ACTIVE_TEST_DB_PATH } from './setup-test-db.js';
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  db,
  DB_FILE_PATH,
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

      // 4. Apenas x-user-id existente (compatibilidade ADT 4.1) -> 200
      const resHeaderOnly = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { 'x-user-id': 'usr-student-02' },
      });
      assert.equal(resHeaderOnly.statusCode, 200);
      assert.equal(resHeaderOnly.json().user.id, 'usr-student-02');

      // 5. x-user-id inexistente no banco -> 401 USER_NOT_FOUND
      const resGhost = await app.inject({
        method: 'GET',
        url: '/api/test-whoami',
        headers: { 'x-user-id': 'usr-nao-existe' },
      });
      assert.equal(resGhost.statusCode, 401);
      assert.equal(resGhost.json().error, 'USER_NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
