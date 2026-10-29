import { cleanupTestDb } from './setup-test-db.js';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { db, resetDatabaseWithSeeds } from '../../db/connection.js';
import { signAuthToken } from '../../db/auth-helper.js';
import { registerWsConnection } from '../../ws/broker.js';
import { stopTtlWorker } from '../../workers/ttl-worker.js';
import { authRoutes } from '../../routes/auth.routes.js';
import { lockersRoutes } from '../../routes/lockers.routes.js';
import { rentalsRoutes } from '../../routes/rentals.routes.js';
import { paymentsRoutes } from '../../routes/payments.routes.js';
import { adminRoutes } from '../../routes/admin.routes.js';
import { createWsSpyClient, type WsSpyClient } from './ws-test-spy.js';
import type {
  CreateRentalResponse,
  ExtendRentalResponse,
  GetRentalDetailsResponse,
  ListLockersResponse,
  LockerCatalogResponse,
  PixMockWebhookResponse,
  QuickLoginResponse,
  ReportIssueResponse,
  WsEnvelope,
} from '../../../shared/types.js';

describe('REGRESSÃO E2E — Core Comercial Dev 2 (Gherkins SPEC, Concorrência RN02, WS Real-Time e Segurança RNF05)', () => {
  let app: FastifyInstance;
  let serverPort: number;
  let spies: WsSpyClient[] = [];

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(websocket);
    app.get('/ws', { websocket: true }, (socket, req) => {
      const query = (req.query as Record<string, string>) || {};
      registerWsConnection(socket, {
        clientType: query.clientType,
        lockerId: query.lockerId,
        userId: query.userId,
      });
    });

    await app.register(authRoutes);
    await app.register(lockersRoutes);
    await app.register(rentalsRoutes);
    await app.register(paymentsRoutes);
    await app.register(adminRoutes);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 0;
  });

  beforeEach(() => {
    stopTtlWorker();
    resetDatabaseWithSeeds();
  });

  afterEach(() => {
    stopTtlWorker();
    for (const s of spies) s.close();
    spies = [];
  });

  after(async () => {
    stopTtlWorker();
    await app.close();
    cleanupTestDb(db);
  });

  function trackSpy(spy: WsSpyClient): WsSpyClient {
    spies.push(spy);
    return spy;
  }

  it('Regressão 1 — Jornada Completa Gherkin (RF01 -> RF02 -> RF03 -> RF04 -> RF05 -> RF07 -> RF09) com WebSocket Real via TCP', async () => {
    // Conecta cliente WebSocket REAL (via protocolo ws://127.0.0.1) representando o celular do Lucas
    const lucasWsMessages: WsEnvelope[] = [];
    const wsClient = new WebSocket(
      `ws://127.0.0.1:${serverPort}/ws?clientType=STUDENT&userId=usr-student-01`,
    );

    await new Promise<void>((resolve, reject) => {
      wsClient.once('open', () => resolve());
      wsClient.once('error', reject);
    });

    wsClient.on('message', (data) => {
      lucasWsMessages.push(JSON.parse(data.toString()) as WsEnvelope);
    });

    try {
      // 1. RF01: Login institucional rápido do Lucas
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Lucas Andrade',
          ra: '20261045',
          email: 'lucas.andrade@faculdade.edu.br',
        },
      });
      assert.equal(loginRes.statusCode, 200);
      const loginBody = loginRes.json() as QuickLoginResponse;
      assert.equal(loginBody.user.id, 'usr-student-01');
      assert.equal(loginBody.activeRentalId, null);

      const authHeaders = {
        authorization: `Bearer ${loginBody.token}`,
        'x-user-id': loginBody.user.id,
      };

      // 2. RF02: Consulta armários e catálogo do Bloco B
      const lockersRes = await app.inject({ method: 'GET', url: '/api/lockers' });
      assert.equal(lockersRes.statusCode, 200);
      const lockersList = (lockersRes.json() as ListLockersResponse).lockers;
      const blocoB = lockersList.find((l) => l.id === 'locker-bloco-b')!;
      assert.equal(blocoB.totalDoorsCount, 4);
      assert.equal(blocoB.availableDoorsCount, 4);

      const catalogBefore = (
        await app.inject({ method: 'GET', url: '/api/lockers/locker-bloco-b/catalog' })
      ).json() as LockerCatalogResponse;
      assert.equal(catalogBefore.doors.length, 4);
      assert.equal(catalogBefore.doors[1].id, 'door-b-02');
      assert.equal(catalogBefore.doors[1].status, 'AVAILABLE');
      assert.equal(catalogBefore.doors[1].item?.requiresPreparation, true);

      // 3. RF03 & RF04: Reserva da Porta #02 (Jaleco: 2 horas = R$ 8,00 / 800 centavos)
      const reserveRes = await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: authHeaders,
        payload: {
          doorId: 'door-b-02',
          planType: 'HOURLY',
          durationUnits: 2,
        },
      });
      assert.equal(reserveRes.statusCode, 201);
      const { rental, payment } = reserveRes.json() as CreateRentalResponse;
      assert.equal(rental.totalAmountCents, 800);
      assert.equal(payment.amountCents, 800);
      assert.equal(rental.status, 'AWAITING_PAYMENT');

      // Novo login do mesmo aluno deve recuperar activeRentalId imediatamente
      const reloginRes = (
        await app.inject({
          method: 'POST',
          url: '/api/auth/quick-login',
          payload: {
            name: 'Lucas Andrade',
            ra: '20261045',
            email: 'lucas.andrade@faculdade.edu.br',
          },
        })
      ).json() as QuickLoginResponse;
      assert.equal(reloginRes.activeRentalId, rental.id);

      // Catálogo agora reflete 3 portas disponíveis e ocupante atual preenchido
      const catalogAfterReserve = (
        await app.inject({ method: 'GET', url: '/api/lockers/locker-bloco-b/catalog' })
      ).json() as LockerCatalogResponse;
      assert.equal(catalogAfterReserve.locker.availableDoorsCount, 3);
      assert.equal(catalogAfterReserve.doors[1].status, 'RESERVED');
      assert.equal(catalogAfterReserve.doors[1].currentOccupantName, 'Lucas Andrade');

      // 4. RF05: Aprovação do pagamento PIX via webhook mock
      const pixRes = await app.inject({
        method: 'POST',
        url: '/api/payments/pix-mock-webhook',
        payload: { rentalId: rental.id },
      });
      assert.equal(pixRes.statusCode, 200);
      const pixBody = pixRes.json() as PixMockWebhookResponse;
      assert.equal(pixBody.rentalStatus, 'PAID_READY_FOR_PICKUP');
      assert.equal(pixBody.canUnlock, true);

      // 5. Simula transição física de retirada (feita no runtime completo pelo Dev 3) para validar RF07 e RF09
      const now = new Date();
      const initialReturnAt = new Date(now.getTime() + 2 * 3_600_000).toISOString();
      db.prepare(
        `UPDATE rentals
         SET status = 'IN_USE',
             first_unlocked_at = ?,
             picked_up_at = ?,
             expected_return_at = ?
         WHERE id = ?`,
      ).run(now.toISOString(), now.toISOString(), initialReturnAt, rental.id);
      db.prepare(`UPDATE doors SET status = 'OCCUPIED_RENTED' WHERE id = 'door-b-02'`).run();

      // RF07: Consulta painel de locação ativa
      const detailsRes = (
        await app.inject({
          method: 'GET',
          url: `/api/rentals/${rental.id}`,
          headers: authHeaders,
        })
      ).json() as GetRentalDetailsResponse;
      assert.equal(detailsRes.rental.status, 'IN_USE');
      assert.equal(detailsRes.payment?.status, 'PAID');
      assert.equal(detailsRes.rental.expectedReturnAt, initialReturnAt);

      // RF09: Prorrogação por +1 Diária (+R$ 12,00 = +1200 centavos -> total 2000 centavos)
      const extendRes = (
        await app.inject({
          method: 'POST',
          url: `/api/rentals/${rental.id}/extend`,
          headers: authHeaders,
          payload: { planType: 'DAILY', additionalUnits: 1 },
        })
      ).json() as ExtendRentalResponse;
      assert.equal(extendRes.success, true);
      assert.equal(extendRes.addedAmountCents, 1200);
      assert.equal(extendRes.rental.totalAmountCents, 2000);

      // Aguarda entrega dos pacotes WebSocket na conexão TCP local
      await new Promise((r) => setTimeout(r, 40));

      const wsEventsReceived = lucasWsMessages.map((m) => m.event);
      assert.ok(wsEventsReceived.includes('CATALOG_STOCK_UPDATED'));
      assert.ok(wsEventsReceived.includes('RENTAL_STATUS_UPDATED'));
    } finally {
      wsClient.close();
    }
  });

  it('Regressão 2 — Condição de Corrida sob Alta Concorrência: 12 alunos disputando a mesma porta (RN02)', async () => {
    // Autentica 12 estudantes distintos
    const tokens: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const login = (
        await app.inject({
          method: 'POST',
          url: '/api/auth/quick-login',
          payload: {
            name: `Estudante Concorrente ${i}`,
            ra: `202699${String(i).padStart(2, '0')}`,
            email: `concorrente.${i}@aluno.faculdade.edu.br`,
          },
        })
      ).json() as QuickLoginResponse;
      tokens.push(login.token);
    }

    // Dispara 12 requisições concorrentes via Promise.all para a mesma porta (door-a-01)
    const responses = await Promise.all(
      tokens.map((token) =>
        app.inject({
          method: 'POST',
          url: '/api/rentals',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            doorId: 'door-a-01',
            planType: 'HOURLY',
            durationUnits: 2,
          },
        }),
      ),
    );

    const createdResponses = responses.filter((r) => r.statusCode === 201);
    const conflictResponses = responses.filter((r) => r.statusCode === 409);

    assert.equal(createdResponses.length, 1, 'Exatamente 1 aluno deve conseguir reservar');
    assert.equal(conflictResponses.length, 11, 'Os outros 11 devem receber HTTP 409 Conflict');

    for (const conflict of conflictResponses) {
      assert.equal(conflict.json().error, 'DOOR_NOT_AVAILABLE');
    }

    const winnerBody = createdResponses[0].json() as CreateRentalResponse;
    const dbRentalCount = (
      db.prepare('SELECT COUNT(*) AS count FROM rentals').get() as { count: number }
    ).count;
    const doorState = db
      .prepare('SELECT status, current_rental_id FROM doors WHERE id = ?')
      .get('door-a-01') as { status: string; current_rental_id: string };

    assert.equal(dbRentalCount, 1);
    assert.equal(doorState.status, 'RESERVED');
    assert.equal(doorState.current_rental_id, winnerBody.rental.id);
  });

  it('Regressão 3 — Expiração Automática TTL (RF16), Bloqueio de Webhook Tardio e Re-locação Limpa', async () => {
    const loginLucas = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Lucas Andrade',
          ra: '20261045',
          email: 'lucas.andrade@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    const loginBeatriz = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Beatriz Silva',
          ra: '20262089',
          email: 'beatriz.silva@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    // Lucas reserva a Porta #03 (Powerbank)
    const lucasReserve = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${loginLucas.token}` },
        payload: { doorId: 'door-b-03', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    // Simula passagem de 11 minutos (TTL expirado)
    const expiredIso = new Date(Date.now() - 60_000).toISOString();
    db.prepare(`UPDATE rentals SET reservation_expires_at = ? WHERE id = ?`).run(
      expiredIso,
      lucasReserve.rental.id,
    );

    // Aciona endpoint administrativo de manutenção que usa expireOverdueReservations() do Dev 2
    const adminTtlRes = await app.inject({
      method: 'POST',
      url: '/api/admin/maintenance/expire-ttl',
    });
    assert.equal(adminTtlRes.statusCode, 200);
    assert.equal(adminTtlRes.json().expiredCount, 1);

    // Tentativa tardia de pagar o PIX da reserva já expirada falha com 409
    const latePix = await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: lucasReserve.rental.id },
    });
    assert.equal(latePix.statusCode, 409);

    // Beatriz consegue alugar a mesma Porta #03 imediatamente
    const beatrizReserve = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${loginBeatriz.token}` },
      payload: { doorId: 'door-b-03', planType: 'DAILY', durationUnits: 1 },
    });
    assert.equal(beatrizReserve.statusCode, 201);
  });

  it('Regressão 4 — Vistoria Expressa em <= 2m bloqueia porta para MAINTENANCE e impede novas locações (RF10)', async () => {
    const lockerASpy = trackSpy(
      createWsSpyClient({ clientType: 'LOCKER', lockerId: 'locker-bloco-a' }),
    );

    const loginBeatriz = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Beatriz Silva',
          ra: '20262089',
          email: 'beatriz.silva@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    const loginLucas = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Lucas Andrade',
          ra: '20261045',
          email: 'lucas.andrade@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    const reserve = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${loginBeatriz.token}` },
        payload: { doorId: 'door-a-02', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: reserve.rental.id },
    });

    // Simula abertura e fechamento há 25 segundos
    const twentyFiveSecAgo = new Date(Date.now() - 25_000).toISOString();
    db.prepare(
      `UPDATE rentals
       SET status = 'IN_USE', first_unlocked_at = ?, picked_up_at = ?
       WHERE id = ?`,
    ).run(twentyFiveSecAgo, twentyFiveSecAgo, reserve.rental.id);
    db.prepare(
      `UPDATE doors SET status = 'OCCUPIED_RENTED', lock_state = 'LOCKED' WHERE id = 'door-a-02'`,
    ).run();

    lockerASpy.clear();

    const issueRes = await app.inject({
      method: 'POST',
      url: `/api/rentals/${reserve.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${loginBeatriz.token}` },
      payload: { issueNotes: 'Cabo USB-C do Powerbank rompido' },
    });
    assert.equal(issueRes.statusCode, 200);
    const issueBody = issueRes.json() as ReportIssueResponse;
    assert.equal(issueBody.doorStatus, 'MAINTENANCE');
    assert.equal(issueBody.paymentStatus, 'REFUNDED');

    // Simulador recebeu comando de abertura para devolução imediata
    assert.equal(lockerASpy.getByEvent('DOOR_UNLOCK_COMMAND').length, 1);

    // Lucas tenta reservar a porta em manutenção -> bloqueado com 409
    const lucasAttempt = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${loginLucas.token}` },
      payload: { doorId: 'door-a-02', planType: 'HOURLY', durationUnits: 1 },
    });
    assert.equal(lucasAttempt.statusCode, 409);
    assert.equal(lucasAttempt.json().error, 'DOOR_NOT_AVAILABLE');
  });

  it('Regressão 5 — Matriz de Segurança RNF05 (Anti-IDOR, Token Inválido e Acesso Admin) + Reset de Demo', async () => {
    const loginLucas = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Lucas Andrade',
          ra: '20261045',
          email: 'lucas.andrade@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    const loginBeatriz = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/quick-login',
        payload: {
          name: 'Beatriz Silva',
          ra: '20262089',
          email: 'beatriz.silva@faculdade.edu.br',
        },
      })
    ).json() as QuickLoginResponse;

    // Quem souber o e-mail da operadora não ganha sessão ADMIN pelo login rápido de aluno
    const adminQuickLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/quick-login',
      payload: {
        name: 'Mariana Costa (Admin)',
        ra: 'ADM001',
        email: 'mariana.admin@faculdade.edu.br',
      },
    });
    assert.equal(adminQuickLogin.statusCode, 403);
    assert.equal(adminQuickLogin.json().error, 'ADMIN_QUICK_LOGIN_FORBIDDEN');

    // Sessão ADMIN legítima (emitida pelo servidor, como faria um login administrativo próprio)
    const adminToken = signAuthToken({
      id: 'usr-admin-01',
      name: 'Mariana Costa (Admin)',
      ra: 'ADM001',
      email: 'mariana.admin@faculdade.edu.br',
      role: 'ADMIN',
    });

    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${loginLucas.token}` },
        payload: { doorId: 'door-b-04', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    // 1. Sem credenciais -> 401
    assert.equal(
      (await app.inject({ method: 'GET', url: `/api/rentals/${created.rental.id}` })).statusCode,
      401,
    );

    // 2. Token forjado -> 401
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/rentals/${created.rental.id}`,
          headers: { authorization: 'Bearer a.b.c' },
        })
      ).statusCode,
      401,
    );

    // 3. Outro estudante tentando ler / prorrogar / reportar defeito -> 403 FORBIDDEN_RENTAL_ACCESS
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/rentals/${created.rental.id}`,
          headers: { authorization: `Bearer ${loginBeatriz.token}` },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rentals/${created.rental.id}/extend`,
          headers: { authorization: `Bearer ${loginBeatriz.token}` },
          payload: { planType: 'HOURLY', additionalUnits: 1 },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rentals/${created.rental.id}/report-issue`,
          headers: { authorization: `Bearer ${loginBeatriz.token}` },
          payload: { issueNotes: 'Tentativa indevida' },
        })
      ).statusCode,
      403,
    );

    // 4. Cadeia de IDOR: o catálogo é público e expõe o id da locação...
    const publicCatalog = (
      await app.inject({ method: 'GET', url: '/api/lockers/locker-bloco-b/catalog' })
    ).json() as LockerCatalogResponse;
    const leakedRentalId = publicCatalog.doors.find((d) => d.id === 'door-b-04')?.currentRentalId;
    assert.equal(leakedRentalId, created.rental.id);

    // ...mas forjar o header x-user-id (do dono ou do admin) sem token não abre nada
    const spoofAttempts: Array<{
      method: 'GET' | 'POST';
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: 'GET', url: `/api/rentals/${leakedRentalId}` },
      {
        method: 'POST',
        url: `/api/rentals/${leakedRentalId}/extend`,
        payload: { planType: 'HOURLY', additionalUnits: 1 },
      },
      {
        method: 'POST',
        url: `/api/rentals/${leakedRentalId}/report-issue`,
        payload: { issueNotes: 'Cancelamento forjado' },
      },
    ];
    for (const spoofedUserId of ['usr-student-01', 'usr-admin-01']) {
      for (const attempt of spoofAttempts) {
        const spoofed = await app.inject({
          method: attempt.method,
          url: attempt.url,
          headers: { 'x-user-id': spoofedUserId },
          payload: attempt.payload,
        });
        assert.equal(
          spoofed.statusCode,
          401,
          `${attempt.method} ${attempt.url} com x-user-id=${spoofedUserId}`,
        );
        assert.equal(spoofed.json().error, 'BEARER_TOKEN_REQUIRED');
      }
    }
    const untouched = db
      .prepare('SELECT status, total_amount_cents FROM rentals WHERE id = ?')
      .get(created.rental.id) as { status: string; total_amount_cents: number };
    assert.deepEqual(untouched, { status: 'AWAITING_PAYMENT', total_amount_cents: 300 });

    // 5. Operadora ADMIN com sessão legítima pode inspecionar a locação para suporte (200 OK)
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/rentals/${created.rental.id}`,
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
      200,
    );

    // 6. Reset de demonstração limpa transações e restaura 100% das portas
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/admin/demo/reset',
    });
    assert.equal(resetRes.statusCode, 200);

    const lockersAfterReset = (
      await app.inject({ method: 'GET', url: '/api/lockers' })
    ).json() as ListLockersResponse;
    const totalAvail = lockersAfterReset.lockers.reduce(
      (acc, l) => acc + (l.availableDoorsCount ?? 0),
      0,
    );
    assert.equal(totalAvail, 6);
  });

  it('Regressão 6 — PIX pago sem retirada em 10 min: locação cancelada e estornada, porta volta ao catálogo e o aluno reserva de novo (RF16)', async () => {
    const loginLucas = async () =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/quick-login',
          payload: {
            name: 'Lucas Andrade',
            ra: '20261045',
            email: 'lucas.andrade@faculdade.edu.br',
          },
        })
      ).json() as QuickLoginResponse;
    const { token } = await loginLucas();
    const reserveJaleco = () =>
      app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${token}` },
        payload: { doorId: 'door-b-02', planType: 'HOURLY', durationUnits: 1 },
      });

    const first = (await reserveJaleco()).json() as CreateRentalResponse;
    await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: first.rental.id },
    });
    assert.equal((await loginLucas()).activeRentalId, first.rental.id);

    // Pagou há 11 minutos e nunca destravou a porta
    db.prepare('UPDATE rentals SET paid_at = ? WHERE id = ?').run(
      new Date(Date.now() - 11 * 60_000).toISOString(),
      first.rental.id,
    );

    const lockers = (
      await app.inject({ method: 'GET', url: '/api/lockers' })
    ).json() as ListLockersResponse;
    assert.equal(lockers.lockers.find((l) => l.id === 'locker-bloco-b')?.availableDoorsCount, 4);
    assert.deepEqual(
      db
        .prepare(
          `SELECT r.status, r.cancel_reason, p.status AS payment_status
           FROM rentals r JOIN payments p ON p.rental_id = r.id WHERE r.id = ?`,
        )
        .get(first.rental.id),
      { status: 'CANCELLED', cancel_reason: 'EXPIRED_TTL', payment_status: 'REFUNDED' },
    );

    assert.equal((await loginLucas()).activeRentalId, null);
    assert.equal((await reserveJaleco()).statusCode, 201);
  });
});
