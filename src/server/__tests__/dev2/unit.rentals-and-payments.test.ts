import { cleanupTestDb } from './setup-test-db.js';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { db, resetDatabaseWithSeeds } from '../../db/connection.js';
import { signAuthToken } from '../../db/auth-helper.js';
import { crc16Ccitt } from '../../db/pix-mock.js';
import { rentalsRoutes } from '../../routes/rentals.routes.js';
import { paymentsRoutes } from '../../routes/payments.routes.js';
import { createWsSpyClient, type WsSpyClient } from './ws-test-spy.js';
import { emvValue, parseEmvTlv } from './emv-test-utils.js';
import type {
  CreateRentalResponse,
  ExtendRentalResponse,
  GetRentalDetailsResponse,
  PixMockWebhookResponse,
  PlanType,
  ReportIssueResponse,
} from '../../../shared/types.js';

describe('BE1-04 & BE1-05 — Reservas Atômicas, PIX Mock, Prorrogação e Vistoria 2m', () => {
  let app: FastifyInstance;
  let spies: WsSpyClient[] = [];

  const tokenStudent1 = signAuthToken({
    id: 'usr-student-01',
    name: 'Lucas Andrade',
    ra: '20261045',
    email: 'lucas.andrade@faculdade.edu.br',
    role: 'STUDENT',
  });

  const tokenStudent2 = signAuthToken({
    id: 'usr-student-02',
    name: 'Beatriz Silva',
    ra: '20262089',
    email: 'beatriz.silva@faculdade.edu.br',
    role: 'STUDENT',
  });

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(rentalsRoutes);
    await app.register(paymentsRoutes);
    await app.ready();
  });

  beforeEach(() => {
    resetDatabaseWithSeeds();
  });

  afterEach(() => {
    for (const s of spies) s.close();
    spies = [];
  });

  after(async () => {
    await app.close();
    cleanupTestDb(db);
  });

  function trackSpy(spy: WsSpyClient): WsSpyClient {
    spies.push(spy);
    return spy;
  }

  function reserve(token: string, doorId: string, planType: PlanType = 'HOURLY', durationUnits = 1) {
    return app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${token}` },
      payload: { doorId, planType, durationUnits },
    });
  }

  function confirmPix(rentalId: string) {
    return app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId },
    });
  }

  function reportIssue(rentalId: string, issueNotes: string, token = tokenStudent1) {
    return app.inject({
      method: 'POST',
      url: `/api/rentals/${rentalId}/report-issue`,
      headers: { authorization: `Bearer ${token}` },
      payload: { issueNotes },
    });
  }

  /** Simula o que o Dev 3 faz no unlock + fechamento da porta (PAID_READY_FOR_PICKUP -> IN_USE). */
  function simulatePickup(rentalId: string, doorId: string, pickedUpAt: Date, durationMs: number): void {
    db.prepare(
      `UPDATE rentals
       SET status = 'IN_USE', first_unlocked_at = ?, picked_up_at = ?, expected_return_at = ?
       WHERE id = ?`,
    ).run(
      pickedUpAt.toISOString(),
      pickedUpAt.toISOString(),
      new Date(pickedUpAt.getTime() + durationMs).toISOString(),
      rentalId,
    );
    db.prepare(`UPDATE doors SET status = 'OCCUPIED_RENTED', lock_state = 'LOCKED' WHERE id = ?`).run(
      doorId,
    );
  }

  function countRentalsOf(userId: string): number {
    return (
      db.prepare('SELECT COUNT(*) AS count FROM rentals WHERE user_id = ?').get(userId) as {
        count: number;
      }
    ).count;
  }

  it('RF03 & RF04: cria reserva por HORA com cálculo exato em centavos, TTL de 10m, PIX Mock e broadcast WS', async () => {
    const studentSpy = trackSpy(
      createWsSpyClient({ clientType: 'STUDENT', userId: 'usr-student-02' }),
    );

    const beforeMs = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: {
        doorId: 'door-b-02', // Jaleco: R$ 4,00/h (400 centavos) | R$ 12,00/dia (1200 centavos)
        planType: 'HOURLY',
        durationUnits: 2,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json() as CreateRentalResponse;
    assert.equal(body.rental.doorId, 'door-b-02');
    assert.equal(body.rental.doorNumber, 2);
    assert.equal(body.rental.totalAmountCents, 800);
    assert.equal(body.rental.status, 'AWAITING_PAYMENT');
    assert.equal(body.payment.amountCents, 800);
    assert.equal(body.payment.status, 'PENDING');
    assert.ok(body.payment.pixCopyPaste.includes('BR.GOV.BCB.PIX'));
    assert.ok(body.payment.pixQrSvg?.startsWith('<svg'));

    const ttlDeltaMs = Date.parse(body.rental.reservationExpiresAt) - beforeMs;
    assert.ok(ttlDeltaMs >= 9 * 60_000 && ttlDeltaMs <= 11 * 60_000);

    // Verifica persistência na porta e em door_events
    const doorRow = db
      .prepare('SELECT status, current_rental_id FROM doors WHERE id = ?')
      .get('door-b-02') as { status: string; current_rental_id: string };
    assert.equal(doorRow.status, 'RESERVED');
    assert.equal(doorRow.current_rental_id, body.rental.id);

    // Verifica evento WS CATALOG_STOCK_UPDATED
    const catalogEvents = studentSpy.getByEvent('CATALOG_STOCK_UPDATED');
    assert.equal(catalogEvents.length, 1);
    assert.equal(catalogEvents[0].payload.door.id, 'door-b-02');
    assert.equal(catalogEvents[0].payload.door.status, 'RESERVED');
  });

  it('RF05: o PIX copia-e-cola gravado na reserva é um BR Code EMV válido com o valor e o id da reserva', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { doorId: 'door-b-02', planType: 'HOURLY', durationUnits: 2 },
    });
    assert.equal(res.statusCode, 201);
    const { rental, payment } = res.json() as CreateRentalResponse;

    const fields = parseEmvTlv(payment.pixCopyPaste);
    assert.deepEqual(
      fields.map((field) => field.id),
      ['00', '26', '52', '53', '54', '58', '59', '60', '62', '63'],
    );
    assert.equal(emvValue(fields, '54'), '8.00');
    assert.equal(emvValue(fields, '60'), 'SAOPAULO');
    const merchantAccount = parseEmvTlv(emvValue(fields, '26') ?? '');
    assert.equal(emvValue(merchantAccount, '01'), `conectalab-pix-mock-${rental.id}`);
    assert.equal(emvValue(fields, '63'), crc16Ccitt(payment.pixCopyPaste.slice(0, -4)));

    const stored = db
      .prepare('SELECT pix_copy_paste FROM payments WHERE rental_id = ?')
      .get(rental.id) as { pix_copy_paste: string };
    assert.equal(stored.pix_copy_paste, payment.pixCopyPaste);
  });

  it('RF03: calcula preço corretamente na modalidade DAILY (Diária)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: {
        doorId: 'door-b-02', // Jaleco: 1200 centavos/dia
        planType: 'DAILY',
        durationUnits: 2,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json() as CreateRentalResponse;
    assert.equal(body.rental.totalAmountCents, 2400);
    assert.equal(body.payment.amountCents, 2400);
  });

  it('RN02: bloqueia tentativa de reservar porta já reservada com HTTP 409 DOOR_NOT_AVAILABLE', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { doorId: 'door-b-03', planType: 'HOURLY', durationUnits: 1 },
    });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent2}` },
      payload: { doorId: 'door-b-03', planType: 'HOURLY', durationUnits: 1 },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, 'DOOR_NOT_AVAILABLE');
  });

  it('RF05: aprova pagamento via webhook PIX Mock, muda locação para PAID_READY_FOR_PICKUP e notifica via WS', async () => {
    const student1Spy = trackSpy(
      createWsSpyClient({ clientType: 'STUDENT', userId: 'usr-student-01' }),
    );
    const adminSpy = trackSpy(createWsSpyClient({ clientType: 'ADMIN' }));

    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent1}` },
        payload: { doorId: 'door-b-01', planType: 'HOURLY', durationUnits: 3 },
      })
    ).json() as CreateRentalResponse;

    student1Spy.clear();
    adminSpy.clear();

    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: created.rental.id },
    });

    assert.equal(webhookRes.statusCode, 200);
    const webhookBody = webhookRes.json() as PixMockWebhookResponse;
    assert.equal(webhookBody.success, true);
    assert.equal(webhookBody.rentalStatus, 'PAID_READY_FOR_PICKUP');
    assert.equal(webhookBody.doorStatus, 'AWAITING_PICKUP');
    assert.equal(webhookBody.canUnlock, true);

    // Segundo disparo do mesmo webhook deve retornar 409 (não está mais AWAITING_PAYMENT)
    const duplicateWebhook = await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: created.rental.id },
    });
    assert.equal(duplicateWebhook.statusCode, 409);
    assert.equal(duplicateWebhook.json().error, 'RENTAL_NOT_AWAITING_PAYMENT');

    // Valida notificações WS enviadas ao celular do Aluno 1 e ao Admin
    assert.equal(student1Spy.getByEvent('RENTAL_STATUS_UPDATED').length, 1);
    assert.equal(
      student1Spy.getByEvent('RENTAL_STATUS_UPDATED')[0].payload.status,
      'PAID_READY_FOR_PICKUP',
    );
    assert.equal(adminSpy.getByEvent('CATALOG_STOCK_UPDATED').length, 1);
  });

  it('RF07 & RNF05: consulta detalhes da locação pelo titular (200) e bloqueia IDOR de outro aluno (403)', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent1}` },
        payload: { doorId: 'door-b-04', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    const ownerGet = await app.inject({
      method: 'GET',
      url: `/api/rentals/${created.rental.id}`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
    });
    assert.equal(ownerGet.statusCode, 200);
    const details = ownerGet.json() as GetRentalDetailsResponse;
    assert.equal(details.rental.id, created.rental.id);
    assert.equal(details.rental.itemName, 'Carregador Rápido USB-C GaN 65W');
    assert.ok(details.payment);

    // Tentativa IDOR por Beatriz (usr-student-02)
    const otherStudentGet = await app.inject({
      method: 'GET',
      url: `/api/rentals/${created.rental.id}`,
      headers: { authorization: `Bearer ${tokenStudent2}` },
    });
    assert.equal(otherStudentGet.statusCode, 403);
    assert.equal(otherStudentGet.json().error, 'FORBIDDEN_RENTAL_ACCESS');
  });

  it('RF09: prorroga horário de locação EM USO (+1h e +1 dia) e bloqueia caso haja restrição de manutenção', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent1}` },
        payload: { doorId: 'door-b-02', planType: 'HOURLY', durationUnits: 1 }, // 400 centavos
      })
    ).json() as CreateRentalResponse;

    // Tentar prorrogar antes de estar IN_USE deve retornar 409
    const earlyExtend = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created.rental.id}/extend`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { planType: 'HOURLY', additionalUnits: 1 },
    });
    assert.equal(earlyExtend.statusCode, 409);
    assert.equal(earlyExtend.json().error, 'RENTAL_NOT_IN_USE');

    // Simula locação já retirada e em uso (IN_USE)
    const initialReturn = new Date(Date.now() + 3_600_000).toISOString();
    db.prepare(
      `UPDATE rentals
       SET status = 'IN_USE',
           paid_at = ?,
           picked_up_at = ?,
           expected_return_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), new Date().toISOString(), initialReturn, created.rental.id);
    db.prepare(`UPDATE doors SET status = 'OCCUPIED_RENTED' WHERE id = 'door-b-02'`).run();

    // Prorroga +2 horas (2 * 400 = +800 centavos -> total 1200)
    const extendRes = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created.rental.id}/extend`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { planType: 'HOURLY', additionalUnits: 2 },
    });
    assert.equal(extendRes.statusCode, 200);
    const extendBody = extendRes.json() as ExtendRentalResponse;
    assert.equal(extendBody.addedAmountCents, 800);
    assert.equal(extendBody.rental.totalAmountCents, 1200);
    assert.equal(
      Date.parse(extendBody.rental.expectedReturnAt!) - Date.parse(initialReturn),
      2 * 3_600_000,
    );

    // Simula bloqueio administrativo de manutenção na porta -> bloqueia nova prorrogação (SPEC RF09 Cenário 2)
    db.prepare(`UPDATE doors SET status = 'MAINTENANCE' WHERE id = 'door-b-02'`).run();
    const restrictedExtend = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created.rental.id}/extend`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { planType: 'HOURLY', additionalUnits: 1 },
    });
    assert.equal(restrictedExtend.statusCode, 409);
    assert.equal(restrictedExtend.json().error, 'EXTENSION_RESTRICTED');
  });

  it('RF10: reporta avaria em <= 120s (cancela, estorna PIX, põe em MAINTENANCE e destrava porta) e nega após 120s com HTTP 400', async () => {
    const lockerSpy = trackSpy(
      createWsSpyClient({ clientType: 'LOCKER', lockerId: 'locker-bloco-b' }),
    );
    lockerSpy.clear();

    // Caso 1: Dentro da janela de 2 minutos com porta já trancada (IN_USE)
    const created1 = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent1}` },
        payload: { doorId: 'door-b-01', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: created1.rental.id },
    });

    const fortySecondsAgo = new Date(Date.now() - 40_000).toISOString();
    db.prepare(
      `UPDATE rentals
       SET status = 'IN_USE', first_unlocked_at = ?, picked_up_at = ?
       WHERE id = ?`,
    ).run(fortySecondsAgo, fortySecondsAgo, created1.rental.id);
    db.prepare(
      `UPDATE doors SET status = 'OCCUPIED_RENTED', lock_state = 'LOCKED' WHERE id = 'door-b-01'`,
    ).run();

    lockerSpy.clear();

    const okIssue = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created1.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { issueNotes: 'Calculadora sem bateria / display apagado' },
    });

    assert.equal(okIssue.statusCode, 200);
    const issueBody = okIssue.json() as ReportIssueResponse;
    assert.equal(issueBody.rentalStatus, 'CANCELLED');
    assert.equal(issueBody.paymentStatus, 'REFUNDED');
    assert.equal(issueBody.doorStatus, 'MAINTENANCE');

    // Confirma que disparou DOOR_UNLOCK_COMMAND para o aluno devolver o item defeituoso
    const unlockCmds = lockerSpy.getByEvent('DOOR_UNLOCK_COMMAND');
    assert.equal(unlockCmds.length, 1);
    assert.equal(unlockCmds[0].payload.doorId, 'door-b-01');
    assert.equal(unlockCmds[0].payload.actionContext, 'RETURN');

    // Caso 2: Fora da janela (> 120 segundos após first_unlocked_at) -> HTTP 400 INSPECTION_WINDOW_EXPIRED
    const created2 = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent2}` },
        payload: { doorId: 'door-b-02', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: created2.rental.id },
    });

    const threeMinutesAgo = new Date(Date.now() - 180_000).toISOString();
    db.prepare(
      `UPDATE rentals
       SET status = 'IN_USE', first_unlocked_at = ?, picked_up_at = ?
       WHERE id = ?`,
    ).run(threeMinutesAgo, threeMinutesAgo, created2.rental.id);

    const expiredIssue = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created2.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${tokenStudent2}` },
      payload: { issueNotes: 'Tentei cancelar depois de 3 minutos' },
    });

    assert.equal(expiredIssue.statusCode, 400);
    assert.equal(expiredIssue.json().error, 'INSPECTION_WINDOW_EXPIRED');

    // Caso 3: Porta ainda ABERTA (PAID_READY_FOR_PICKUP + UNLOCKED) dentro de 120s -> estorna sem re-disparar DOOR_UNLOCK_COMMAND
    const created3 = (
      await app.inject({
        method: 'POST',
        url: '/api/rentals',
        headers: { authorization: `Bearer ${tokenStudent1}` },
        payload: { doorId: 'door-b-03', planType: 'HOURLY', durationUnits: 1 },
      })
    ).json() as CreateRentalResponse;

    // Antes de destravar pela primeira vez -> 400 RENTAL_NOT_UNLOCKED_YET
    await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: created3.rental.id },
    });
    const beforeUnlockIssue = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created3.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { issueNotes: 'Ainda nem abri a porta' },
    });
    assert.equal(beforeUnlockIssue.statusCode, 400);
    assert.equal(beforeUnlockIssue.json().error, 'RENTAL_NOT_UNLOCKED_YET');

    // Agora simula porta destravada e ainda aberta
    db.prepare(`UPDATE rentals SET first_unlocked_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 10_000).toISOString(),
      created3.rental.id,
    );
    db.prepare(`UPDATE doors SET lock_state = 'UNLOCKED' WHERE id = 'door-b-03'`).run();
    lockerSpy.clear();

    const whileOpenIssue = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created3.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { issueNotes: 'Powerbank inchado visível ao abrir a porta' },
    });
    assert.equal(whileOpenIssue.statusCode, 200);
    assert.equal(lockerSpy.getByEvent('DOOR_UNLOCK_COMMAND').length, 0);

    // Tentar reportar novamente na mesma locação já cancelada -> 409 RENTAL_ALREADY_CLOSED
    const closedIssue = await app.inject({
      method: 'POST',
      url: `/api/rentals/${created3.rental.id}/report-issue`,
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { issueNotes: 'Duplicado' },
    });
    assert.equal(closedIssue.statusCode, 409);
    assert.equal(closedIssue.json().error, 'RENTAL_ALREADY_CLOSED');
  });

  it('valida casos de borda HTTP 400 / 404 / 409 em reservas e webhook PIX', async () => {
    // Payload inválido na criação de reserva -> 400 INVALID_RENTAL_INPUT
    const badInput = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { doorId: 'door-b-01', planType: 'HOURLY', durationUnits: 0 },
    });
    assert.equal(badInput.statusCode, 400);
    assert.equal(badInput.json().error, 'INVALID_RENTAL_INPUT');

    // Porta inexistente -> 404 DOOR_NOT_FOUND
    const missingDoor = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { doorId: 'door-inexistente', planType: 'HOURLY', durationUnits: 1 },
    });
    assert.equal(missingDoor.statusCode, 404);
    assert.equal(missingDoor.json().error, 'DOOR_NOT_FOUND');

    // Porta sem item vinculado -> 409 DOOR_WITHOUT_ITEM
    db.prepare(`UPDATE doors SET item_id = NULL WHERE id = 'door-b-04'`).run();
    const emptyDoor = await app.inject({
      method: 'POST',
      url: '/api/rentals',
      headers: { authorization: `Bearer ${tokenStudent1}` },
      payload: { doorId: 'door-b-04', planType: 'HOURLY', durationUnits: 1 },
    });
    assert.equal(emptyDoor.statusCode, 409);
    assert.equal(emptyDoor.json().error, 'DOOR_WITHOUT_ITEM');

    // Webhook PIX sem rentalId -> 400 INVALID_WEBHOOK_PAYLOAD
    const emptyWebhook = await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: {},
    });
    assert.equal(emptyWebhook.statusCode, 400);
    assert.equal(emptyWebhook.json().error, 'INVALID_WEBHOOK_PAYLOAD');

    // Webhook PIX para locação inexistente -> 404 RENTAL_NOT_FOUND
    const missingWebhook = await app.inject({
      method: 'POST',
      url: '/api/payments/pix-mock-webhook',
      payload: { rentalId: 'rnt-fantasma' },
    });
    assert.equal(missingWebhook.statusCode, 404);
    assert.equal(missingWebhook.json().error, 'RENTAL_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Uma locação ativa por aluno (o login devolve um único activeRentalId)
  // ---------------------------------------------------------------------------

  it('com uma reserva aguardando PIX, o mesmo aluno não reserva outra porta (409 USER_HAS_ACTIVE_RENTAL)', async () => {
    assert.equal((await reserve(tokenStudent1, 'door-b-01')).statusCode, 201);
    const watcher = trackSpy(createWsSpyClient({ clientType: 'STUDENT', userId: 'usr-student-02' }));
    watcher.clear();

    const second = await reserve(tokenStudent1, 'door-b-02');

    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, 'USER_HAS_ACTIVE_RENTAL');
    assert.equal(countRentalsOf('usr-student-01'), 1);
    assert.deepEqual(
      db.prepare(`SELECT status, current_rental_id FROM doors WHERE id = 'door-b-02'`).get(),
      { status: 'AVAILABLE', current_rental_id: null },
    );
    assert.equal(watcher.getByEvent('CATALOG_STOCK_UPDATED').length, 0);
  });

  it('PAID_READY_FOR_PICKUP, IN_USE e AWAITING_RETURN_CLOSE também impedem uma segunda reserva', async () => {
    for (const status of ['PAID_READY_FOR_PICKUP', 'IN_USE', 'AWAITING_RETURN_CLOSE'] as const) {
      resetDatabaseWithSeeds();
      const first = (await reserve(tokenStudent1, 'door-b-01')).json() as CreateRentalResponse;
      db.prepare('UPDATE rentals SET status = ? WHERE id = ?').run(status, first.rental.id);

      const second = await reserve(tokenStudent1, 'door-b-03');

      assert.equal(second.statusCode, 409, `locação anterior em ${status}`);
      assert.equal(second.json().error, 'USER_HAS_ACTIVE_RENTAL');
    }
  });

  it('libera nova reserva quando a anterior foi concluída, cancelada ou expirou por TTL', async () => {
    for (const finalStatus of ['COMPLETED', 'CANCELLED'] as const) {
      resetDatabaseWithSeeds();
      const first = (await reserve(tokenStudent1, 'door-b-01')).json() as CreateRentalResponse;
      db.prepare('UPDATE rentals SET status = ? WHERE id = ?').run(finalStatus, first.rental.id);
      db.prepare(`UPDATE doors SET status = 'AVAILABLE', current_rental_id = NULL WHERE id = 'door-b-01'`).run();

      assert.equal((await reserve(tokenStudent1, 'door-b-03')).statusCode, 201, `após ${finalStatus}`);
    }

    resetDatabaseWithSeeds();
    const expired = (await reserve(tokenStudent1, 'door-b-01')).json() as CreateRentalResponse;
    db.prepare('UPDATE rentals SET reservation_expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 1_000).toISOString(),
      expired.rental.id,
    );

    assert.equal((await reserve(tokenStudent1, 'door-b-03')).statusCode, 201);
    assert.deepEqual(
      db.prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?').get(expired.rental.id),
      { status: 'CANCELLED', cancel_reason: 'EXPIRED_TTL' },
    );
  });

  it('5 reservas simultâneas do mesmo aluno em portas diferentes resultam em 1 criada e 4 recusadas', async () => {
    const doorIds = ['door-b-01', 'door-b-02', 'door-b-03', 'door-b-04', 'door-a-01'];

    const responses = await Promise.all(doorIds.map((doorId) => reserve(tokenStudent1, doorId)));

    const created = responses.filter((r) => r.statusCode === 201);
    const refused = responses.filter((r) => r.statusCode === 409);
    assert.equal(created.length, 1);
    assert.equal(refused.length, 4);
    for (const r of refused) assert.equal(r.json().error, 'USER_HAS_ACTIVE_RENTAL');
    assert.equal(countRentalsOf('usr-student-01'), 1);
    assert.deepEqual(
      db.prepare(`SELECT COUNT(*) AS count FROM doors WHERE status = 'RESERVED'`).get(),
      { count: 1 },
    );
  });

  // ---------------------------------------------------------------------------
  // RF09: prorrogação mantém plano, duração, prazo e total coerentes
  // ---------------------------------------------------------------------------

  const extensionCases: Array<{
    name: string;
    initial: { planType: PlanType; units: number; hours: number; paidCents: number };
    extensions: Array<{ planType: PlanType; additionalUnits: number; addedAmountCents: number }>;
    expected: { planType: PlanType; durationUnits: number; totalCents: number; hoursFromPickup: number };
  }> = [
    {
      name: 'por hora (2h) + 1h',
      initial: { planType: 'HOURLY', units: 2, hours: 2, paidCents: 800 },
      extensions: [{ planType: 'HOURLY', additionalUnits: 1, addedAmountCents: 400 }],
      expected: { planType: 'HOURLY', durationUnits: 3, totalCents: 1200, hoursFromPickup: 3 },
    },
    {
      name: 'por hora (2h) + 1 diária',
      initial: { planType: 'HOURLY', units: 2, hours: 2, paidCents: 800 },
      extensions: [{ planType: 'DAILY', additionalUnits: 1, addedAmountCents: 1200 }],
      expected: { planType: 'HOURLY', durationUnits: 26, totalCents: 2000, hoursFromPickup: 26 },
    },
    {
      name: 'diária (1) + 2h',
      initial: { planType: 'DAILY', units: 1, hours: 24, paidCents: 1200 },
      extensions: [{ planType: 'HOURLY', additionalUnits: 2, addedAmountCents: 800 }],
      expected: { planType: 'HOURLY', durationUnits: 26, totalCents: 2000, hoursFromPickup: 26 },
    },
    {
      name: 'diária (1) + 1 diária',
      initial: { planType: 'DAILY', units: 1, hours: 24, paidCents: 1200 },
      extensions: [{ planType: 'DAILY', additionalUnits: 1, addedAmountCents: 1200 }],
      expected: { planType: 'DAILY', durationUnits: 2, totalCents: 2400, hoursFromPickup: 48 },
    },
    {
      name: 'por hora (1h) + 1 diária + 2h',
      initial: { planType: 'HOURLY', units: 1, hours: 1, paidCents: 400 },
      extensions: [
        { planType: 'DAILY', additionalUnits: 1, addedAmountCents: 1200 },
        { planType: 'HOURLY', additionalUnits: 2, addedAmountCents: 800 },
      ],
      expected: { planType: 'HOURLY', durationUnits: 27, totalCents: 2400, hoursFromPickup: 27 },
    },
  ];

  for (const c of extensionCases) {
    it(`RF09: prorrogação ${c.name} deixa plano, duração, prazo e total coerentes sem mexer no PIX já pago`, async () => {
      const created = (
        await reserve(tokenStudent1, 'door-b-02', c.initial.planType, c.initial.units)
      ).json() as CreateRentalResponse;
      await confirmPix(created.rental.id);
      const pickedUpAt = new Date(Date.now() - 60_000);
      simulatePickup(created.rental.id, 'door-b-02', pickedUpAt, c.initial.hours * 3_600_000);

      for (const ext of c.extensions) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/rentals/${created.rental.id}/extend`,
          headers: { authorization: `Bearer ${tokenStudent1}` },
          payload: { planType: ext.planType, additionalUnits: ext.additionalUnits },
        });
        assert.equal(res.statusCode, 200);
        assert.equal((res.json() as ExtendRentalResponse).addedAmountCents, ext.addedAmountCents);
      }

      const row = db
        .prepare(
          `SELECT r.plan_type, r.duration_units, r.total_amount_cents, r.expected_return_at,
                  p.amount_cents AS paid_cents, p.status AS payment_status
           FROM rentals r JOIN payments p ON p.rental_id = r.id
           WHERE r.id = ?`,
        )
        .get(created.rental.id) as {
        plan_type: PlanType;
        duration_units: number;
        total_amount_cents: number;
        expected_return_at: string;
        paid_cents: number;
        payment_status: string;
      };
      assert.equal(row.plan_type, c.expected.planType);
      assert.equal(row.duration_units, c.expected.durationUnits);
      assert.equal(row.total_amount_cents, c.expected.totalCents);
      assert.equal(
        Date.parse(row.expected_return_at) - pickedUpAt.getTime(),
        c.expected.hoursFromPickup * 3_600_000,
      );
      assert.equal(row.paid_cents, c.initial.paidCents, 'o PIX pago não pode mudar de valor');
      assert.equal(row.payment_status, 'PAID');
    });
  }

  // ---------------------------------------------------------------------------
  // RF10: vistoria expressa
  // ---------------------------------------------------------------------------

  it('RF10: vistoria pedida com a devolução já iniciada responde 409 RENTAL_RETURN_IN_PROGRESS sem alterar nada', async () => {
    const created = (await reserve(tokenStudent1, 'door-b-01')).json() as CreateRentalResponse;
    await confirmPix(created.rental.id);
    const twentySecondsAgo = new Date(Date.now() - 20_000).toISOString();
    db.prepare(
      `UPDATE rentals SET status = 'AWAITING_RETURN_CLOSE', first_unlocked_at = ?, picked_up_at = ? WHERE id = ?`,
    ).run(twentySecondsAgo, twentySecondsAgo, created.rental.id);
    db.prepare(`UPDATE doors SET status = 'OCCUPIED_RENTED', lock_state = 'UNLOCKED' WHERE id = 'door-b-01'`).run();
    const lockerSpy = trackSpy(createWsSpyClient({ clientType: 'LOCKER', lockerId: 'locker-bloco-b' }));
    lockerSpy.clear();

    const res = await reportIssue(created.rental.id, 'Percebi o defeito na hora de devolver');

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'RENTAL_RETURN_IN_PROGRESS');
    assert.deepEqual(
      db
        .prepare(
          `SELECT r.status, r.cancel_reason, p.status AS payment_status,
                  d.status AS door_status, d.lock_state, d.current_rental_id
           FROM rentals r JOIN payments p ON p.rental_id = r.id JOIN doors d ON d.id = r.door_id
           WHERE r.id = ?`,
        )
        .get(created.rental.id),
      {
        status: 'AWAITING_RETURN_CLOSE',
        cancel_reason: null,
        payment_status: 'PAID',
        door_status: 'OCCUPIED_RENTED',
        lock_state: 'UNLOCKED',
        current_rental_id: created.rental.id,
      },
    );
    assert.equal(lockerSpy.messages.length, 0);
  });

  it('RF10: aceita relato de até 500 caracteres e recusa acima disso sem cancelar a locação', async () => {
    const created = (await reserve(tokenStudent1, 'door-b-01')).json() as CreateRentalResponse;
    await confirmPix(created.rental.id);
    simulatePickup(created.rental.id, 'door-b-01', new Date(Date.now() - 30_000), 3_600_000);

    const tooLong = await reportIssue(created.rental.id, 'x'.repeat(501));
    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().error, 'INVALID_ISSUE_NOTES');
    assert.deepEqual(db.prepare('SELECT status FROM rentals WHERE id = ?').get(created.rental.id), {
      status: 'IN_USE',
    });

    const atLimit = await reportIssue(created.rental.id, 'x'.repeat(500));
    assert.equal(atLimit.statusCode, 200);
    const stored = db.prepare('SELECT issue_notes FROM rentals WHERE id = ?').get(created.rental.id) as {
      issue_notes: string;
    };
    assert.equal(stored.issue_notes.length, 500);
  });
});
