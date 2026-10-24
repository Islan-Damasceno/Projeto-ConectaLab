import { cleanupTestDb } from './setup-test-db.js';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { DoorStatus, PaymentStatus, RentalStatus } from '../../../shared/types.js';
import { db, resetDatabaseWithSeeds } from '../../db/connection.js';
import {
  expireOverdueReservations,
  startTtlWorker,
  stopTtlWorker,
} from '../../workers/ttl-worker.js';
import { createWsSpyClient, type WsSpyClient } from './ws-test-spy.js';

interface SeedRentalOptions {
  rentalId: string;
  paymentId: string;
  userId?: string;
  lockerId?: string;
  doorId?: string;
  itemId?: string;
  rentalStatus?: RentalStatus;
  paymentStatus?: PaymentStatus;
  doorStatus?: DoorStatus;
  reservationExpiresAt: string;
  paidAt?: string | null;
  pickedUpAt?: string | null;
  expectedReturnAt?: string | null;
  createdAt?: string;
}

function seedRentalScenario(opts: SeedRentalOptions): void {
  const userId = opts.userId ?? 'usr-student-01';
  const lockerId = opts.lockerId ?? 'locker-bloco-b';
  const doorId = opts.doorId ?? 'door-b-01';
  const itemId = opts.itemId ?? 'itm-01';
  const rentalStatus = opts.rentalStatus ?? 'AWAITING_PAYMENT';
  const paymentStatus = opts.paymentStatus ?? 'PENDING';
  const doorStatus = opts.doorStatus ?? 'RESERVED';
  const createdAt = opts.createdAt ?? '2026-10-24T20:00:00.000Z';

  db.prepare(
    `INSERT INTO rentals (
       id, user_id, locker_id, door_id, item_id,
       plan_type, duration_units, total_amount_cents,
       status, reservation_expires_at, paid_at, picked_up_at, expected_return_at, created_at
     ) VALUES (?, ?, ?, ?, ?, 'HOURLY', 2, 400, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.rentalId,
    userId,
    lockerId,
    doorId,
    itemId,
    rentalStatus,
    opts.reservationExpiresAt,
    opts.paidAt ?? null,
    opts.pickedUpAt ?? null,
    opts.expectedReturnAt ?? null,
    createdAt,
  );

  db.prepare(
    `INSERT INTO payments (
       id, rental_id, amount_cents, method, status, pix_copy_paste, paid_at, created_at
     ) VALUES (?, ?, 400, 'PIX_MOCK', ?, ?, ?, ?)`,
  ).run(
    opts.paymentId,
    opts.rentalId,
    paymentStatus,
    `000201-mock-${opts.rentalId}`,
    opts.paidAt ?? null,
    createdAt,
  );

  db.prepare(
    `UPDATE doors
     SET status = ?, current_rental_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(doorStatus, opts.rentalId, createdAt, doorId);
}

describe('Unit — TTL Worker (BE1-06 / RF16 / RN02)', () => {
  const activeSpies: WsSpyClient[] = [];

  function connectSpy(query: Parameters<typeof createWsSpyClient>[0]): WsSpyClient {
    const spy = createWsSpyClient(query);
    spy.clear(); // Descarta handshake inicial (ex: LOCKER_CONNECTED) para isolar asserções
    activeSpies.push(spy);
    return spy;
  }

  beforeEach(() => {
    resetDatabaseWithSeeds();
  });

  afterEach(() => {
    stopTtlWorker();
    while (activeSpies.length > 0) {
      activeSpies.pop()?.close();
    }
  });

  after(() => {
    cleanupTestDb(db);
  });

  it('1. retorna 0 e não emite eventos WS quando não há reservas vencidas', () => {
    const studentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-01' });
    const lockerSpy = connectSpy({ clientType: 'LOCKER', lockerId: 'locker-bloco-b' });
    const adminSpy = connectSpy({ clientType: 'ADMIN' });

    const expiredCount = expireOverdueReservations(new Date('2026-10-24T21:00:00.000Z'));

    assert.equal(expiredCount, 0);
    assert.equal(studentSpy.messages.length, 0);
    assert.equal(lockerSpy.messages.length, 0);
    assert.equal(adminSpy.messages.length, 0);

    const eventsCount = db.prepare('SELECT COUNT(*) as count FROM door_events').get() as {
      count: number;
    };
    assert.equal(eventsCount.count, 0);
  });

  it('2. expira reserva em AWAITING_PAYMENT vencida, libera a porta, grava auditoria e notifica clientes WS', () => {
    const referenceNow = new Date('2026-10-24T21:15:00.000Z');

    seedRentalScenario({
      rentalId: 'rnt-overdue-01',
      paymentId: 'pay-overdue-01',
      userId: 'usr-student-01',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-01',
      itemId: 'itm-01',
      rentalStatus: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      doorStatus: 'RESERVED',
      reservationExpiresAt: '2026-10-24T21:10:00.000Z',
    });

    const ownerStudentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-01' });
    const otherStudentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-02' });
    const lockerSpy = connectSpy({ clientType: 'LOCKER', lockerId: 'locker-bloco-b' });
    const adminSpy = connectSpy({ clientType: 'ADMIN' });

    const expiredCount = expireOverdueReservations(referenceNow);
    assert.equal(expiredCount, 1);

    // 1. Verifica locação cancelada por EXPIRED_TTL
    const rentalRow = db
      .prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?')
      .get('rnt-overdue-01') as { status: RentalStatus; cancel_reason: string | null };
    assert.equal(rentalRow.status, 'CANCELLED');
    assert.equal(rentalRow.cancel_reason, 'EXPIRED_TTL');

    // 2. Verifica pagamento marcado como EXPIRED
    const paymentRow = db
      .prepare('SELECT status FROM payments WHERE id = ?')
      .get('pay-overdue-01') as { status: PaymentStatus };
    assert.equal(paymentRow.status, 'EXPIRED');

    // 3. Verifica porta liberada (AVAILABLE e current_rental_id = NULL)
    const doorRow = db
      .prepare('SELECT status, lock_state, current_rental_id, updated_at FROM doors WHERE id = ?')
      .get('door-b-01') as {
      status: DoorStatus;
      lock_state: string;
      current_rental_id: string | null;
      updated_at: string;
    };
    assert.equal(doorRow.status, 'AVAILABLE');
    assert.equal(doorRow.lock_state, 'LOCKED');
    assert.equal(doorRow.current_rental_id, null);
    assert.equal(doorRow.updated_at, referenceNow.toISOString());

    // 4. Verifica registro de auditoria em door_events
    const doorEvents = db
      .prepare(
        'SELECT door_id, rental_id, user_id, event_type, details_json, created_at FROM door_events WHERE rental_id = ?',
      )
      .all('rnt-overdue-01') as Array<{
      door_id: string;
      rental_id: string;
      user_id: string;
      event_type: string;
      details_json: string;
      created_at: string;
    }>;
    assert.equal(doorEvents.length, 1);
    assert.equal(doorEvents[0].door_id, 'door-b-01');
    assert.equal(doorEvents[0].user_id, 'usr-student-01');
    assert.equal(doorEvents[0].event_type, 'STATUS_CHANGE');
    assert.equal(doorEvents[0].created_at, referenceNow.toISOString());
    assert.deepEqual(JSON.parse(doorEvents[0].details_json), {
      from: 'RESERVED',
      to: 'AVAILABLE',
      reason: 'EXPIRED_TTL',
    });

    // 5. Verifica entrega dos eventos WebSocket pós-COMMIT
    for (const spy of [ownerStudentSpy, otherStudentSpy, lockerSpy, adminSpy]) {
      const stockEvents = spy.getByEvent('CATALOG_STOCK_UPDATED');
      assert.equal(stockEvents.length, 1);
      assert.deepEqual(stockEvents[0].payload, {
        lockerId: 'locker-bloco-b',
        door: {
          id: 'door-b-01',
          doorNumber: 1,
          status: 'AVAILABLE',
          lockState: 'LOCKED',
          currentRentalId: null,
          currentOccupantName: null,
          expectedReturnAt: null,
        },
      });
    }

    const expectedRentalPayload = {
      rentalId: 'rnt-overdue-01',
      status: 'CANCELLED',
      doorId: 'door-b-01',
      doorNumber: 1,
      doorStatus: 'AVAILABLE',
      lockState: 'LOCKED',
    };

    const ownerRentalEvents = ownerStudentSpy.getByEvent('RENTAL_STATUS_UPDATED');
    assert.equal(ownerRentalEvents.length, 1);
    assert.deepEqual(ownerRentalEvents[0].payload, expectedRentalPayload);

    const adminRentalEvents = adminSpy.getByEvent('RENTAL_STATUS_UPDATED');
    assert.equal(adminRentalEvents.length, 1);
    assert.deepEqual(adminRentalEvents[0].payload, expectedRentalPayload);

    // Outro estudante não deve receber RENTAL_STATUS_UPDATED alheio
    assert.equal(otherStudentSpy.getByEvent('RENTAL_STATUS_UPDATED').length, 0);
  });

  it('3. NÃO cancela reserva em AWAITING_PAYMENT cujo reservation_expires_at ainda está no futuro', () => {
    const referenceNow = new Date('2026-10-24T21:05:00.000Z');

    seedRentalScenario({
      rentalId: 'rnt-future-01',
      paymentId: 'pay-future-01',
      userId: 'usr-student-01',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-02',
      itemId: 'itm-02',
      rentalStatus: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      doorStatus: 'RESERVED',
      reservationExpiresAt: '2026-10-24T21:10:00.000Z',
    });

    const studentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-01' });
    const adminSpy = connectSpy({ clientType: 'ADMIN' });

    const expiredCount = expireOverdueReservations(referenceNow);
    assert.equal(expiredCount, 0);

    const rentalRow = db
      .prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?')
      .get('rnt-future-01') as { status: RentalStatus; cancel_reason: string | null };
    assert.equal(rentalRow.status, 'AWAITING_PAYMENT');
    assert.equal(rentalRow.cancel_reason, null);

    const paymentRow = db
      .prepare('SELECT status FROM payments WHERE id = ?')
      .get('pay-future-01') as { status: PaymentStatus };
    assert.equal(paymentRow.status, 'PENDING');

    const doorRow = db
      .prepare('SELECT status, current_rental_id FROM doors WHERE id = ?')
      .get('door-b-02') as { status: DoorStatus; current_rental_id: string | null };
    assert.equal(doorRow.status, 'RESERVED');
    assert.equal(doorRow.current_rental_id, 'rnt-future-01');

    assert.equal(studentSpy.messages.length, 0);
    assert.equal(adminSpy.messages.length, 0);
  });

  it('4. NÃO cancela locações em PAID_READY_FOR_PICKUP ou IN_USE mesmo com reservation_expires_at no passado', () => {
    const referenceNow = new Date('2026-10-24T22:00:00.000Z');

    seedRentalScenario({
      rentalId: 'rnt-paid-01',
      paymentId: 'pay-paid-01',
      userId: 'usr-student-01',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-01',
      itemId: 'itm-01',
      rentalStatus: 'PAID_READY_FOR_PICKUP',
      paymentStatus: 'PAID',
      doorStatus: 'AWAITING_PICKUP',
      reservationExpiresAt: '2026-10-24T20:10:00.000Z',
      paidAt: '2026-10-24T20:05:00.000Z',
    });

    seedRentalScenario({
      rentalId: 'rnt-inuse-02',
      paymentId: 'pay-inuse-02',
      userId: 'usr-student-02',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-02',
      itemId: 'itm-02',
      rentalStatus: 'IN_USE',
      paymentStatus: 'PAID',
      doorStatus: 'OCCUPIED_RENTED',
      reservationExpiresAt: '2026-10-24T20:10:00.000Z',
      paidAt: '2026-10-24T20:05:00.000Z',
      pickedUpAt: '2026-10-24T20:06:00.000Z',
      expectedReturnAt: '2026-10-24T23:06:00.000Z',
    });

    const adminSpy = connectSpy({ clientType: 'ADMIN' });

    const expiredCount = expireOverdueReservations(referenceNow);
    assert.equal(expiredCount, 0);

    const paidRental = db
      .prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?')
      .get('rnt-paid-01') as { status: RentalStatus; cancel_reason: string | null };
    assert.equal(paidRental.status, 'PAID_READY_FOR_PICKUP');
    assert.equal(paidRental.cancel_reason, null);

    const inUseRental = db
      .prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?')
      .get('rnt-inuse-02') as { status: RentalStatus; cancel_reason: string | null };
    assert.equal(inUseRental.status, 'IN_USE');
    assert.equal(inUseRental.cancel_reason, null);

    const door1 = db.prepare('SELECT status, current_rental_id FROM doors WHERE id = ?').get(
      'door-b-01',
    ) as { status: DoorStatus; current_rental_id: string | null };
    assert.equal(door1.status, 'AWAITING_PICKUP');
    assert.equal(door1.current_rental_id, 'rnt-paid-01');

    const door2 = db.prepare('SELECT status, current_rental_id FROM doors WHERE id = ?').get(
      'door-b-02',
    ) as { status: DoorStatus; current_rental_id: string | null };
    assert.equal(door2.status, 'OCCUPIED_RENTED');
    assert.equal(door2.current_rental_id, 'rnt-inuse-02');

    assert.equal(adminSpy.messages.length, 0);
  });

  it('5. garante idempotência em chamadas consecutivas sem duplicar logs ou eventos WS', () => {
    const referenceNow = new Date('2026-10-24T21:30:00.000Z');

    seedRentalScenario({
      rentalId: 'rnt-idemp-01',
      paymentId: 'pay-idemp-01',
      userId: 'usr-student-01',
      lockerId: 'locker-bloco-a',
      doorId: 'door-a-01',
      itemId: 'itm-05',
      rentalStatus: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      doorStatus: 'RESERVED',
      reservationExpiresAt: '2026-10-24T21:30:00.000Z', // Limite exato (<= nowIso)
    });

    const studentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-01' });

    const firstRun = expireOverdueReservations(referenceNow);
    assert.equal(firstRun, 1);
    assert.equal(studentSpy.getByEvent('CATALOG_STOCK_UPDATED').length, 1);
    assert.equal(studentSpy.getByEvent('RENTAL_STATUS_UPDATED').length, 1);

    const secondRun = expireOverdueReservations(referenceNow);
    assert.equal(secondRun, 0);

    // Continua com apenas 1 evento de cada e 1 log de auditoria no banco
    assert.equal(studentSpy.getByEvent('CATALOG_STOCK_UPDATED').length, 1);
    assert.equal(studentSpy.getByEvent('RENTAL_STATUS_UPDATED').length, 1);

    const eventsCount = db
      .prepare('SELECT COUNT(*) as count FROM door_events WHERE rental_id = ?')
      .get('rnt-idemp-01') as { count: number };
    assert.equal(eventsCount.count, 1);
  });

  it('6. ciclo periódico startTtlWorker(40) / stopTtlWorker() limpa reservas vencidas automaticamente em background', async () => {
    const pastExpiresAt = new Date(Date.now() - 60_000).toISOString();

    seedRentalScenario({
      rentalId: 'rnt-bg-01',
      paymentId: 'pay-bg-01',
      userId: 'usr-student-01',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-03',
      itemId: 'itm-03',
      rentalStatus: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      doorStatus: 'RESERVED',
      reservationExpiresAt: pastExpiresAt,
    });

    const studentSpy = connectSpy({ clientType: 'STUDENT', userId: 'usr-student-01' });

    // Chamar startTtlWorker duas vezes não deve duplicar timers
    startTtlWorker(40);
    startTtlWorker(40);

    await delay(130);
    stopTtlWorker();

    const rentalRow = db
      .prepare('SELECT status, cancel_reason FROM rentals WHERE id = ?')
      .get('rnt-bg-01') as { status: RentalStatus; cancel_reason: string | null };
    assert.equal(rentalRow.status, 'CANCELLED');
    assert.equal(rentalRow.cancel_reason, 'EXPIRED_TTL');

    const paymentRow = db
      .prepare('SELECT status FROM payments WHERE id = ?')
      .get('pay-bg-01') as { status: PaymentStatus };
    assert.equal(paymentRow.status, 'EXPIRED');

    const doorRow = db
      .prepare('SELECT status, current_rental_id FROM doors WHERE id = ?')
      .get('door-b-03') as { status: DoorStatus; current_rental_id: string | null };
    assert.equal(doorRow.status, 'AVAILABLE');
    assert.equal(doorRow.current_rental_id, null);

    assert.equal(studentSpy.getByEvent('CATALOG_STOCK_UPDATED').length, 1);
    assert.equal(studentSpy.getByEvent('RENTAL_STATUS_UPDATED').length, 1);

    // Após stopTtlWorker(), novas reservas vencidas não devem ser varridas automaticamente
    seedRentalScenario({
      rentalId: 'rnt-bg-after-stop',
      paymentId: 'pay-bg-after-stop',
      userId: 'usr-student-02',
      lockerId: 'locker-bloco-b',
      doorId: 'door-b-04',
      itemId: 'itm-04',
      rentalStatus: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      doorStatus: 'RESERVED',
      reservationExpiresAt: pastExpiresAt,
    });

    await delay(90);

    const untouchedRental = db
      .prepare('SELECT status FROM rentals WHERE id = ?')
      .get('rnt-bg-after-stop') as { status: RentalStatus };
    assert.equal(untouchedRental.status, 'AWAITING_PAYMENT');
  });
});
