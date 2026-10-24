import { cleanupTestDb } from './setup-test-db.js';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { db, resetDatabaseWithSeeds } from '../../db/connection.js';
import { lockersRoutes } from '../../routes/lockers.routes.js';
import type {
  ListLockersResponse,
  LockerCatalogResponse,
  ApiErrorResponse,
} from '../../../shared/types.js';

describe('Card BE1-03 — Rotas de Armários e Catálogo (RF02, RF11, RF14, RN01)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(lockersRoutes);
    await app.ready();
  });

  beforeEach(() => {
    resetDatabaseWithSeeds();
  });

  after(async () => {
    await app.close();
    cleanupTestDb(db);
  });

  it('1. GET /api/lockers deve retornar os 2 armários dos seeds na ordem de inserção com contagens exatas e isOnline booleano', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/lockers',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<ListLockersResponse>();
    assert.equal(body.lockers.length, 2);

    const [blocoB, blocoA] = body.lockers;

    assert.equal(blocoB.id, 'locker-bloco-b');
    assert.equal(blocoB.code, 'BLOCO-B-01');
    assert.equal(blocoB.totalDoorsCount, 4);
    assert.equal(blocoB.availableDoorsCount, 4);
    assert.equal(typeof blocoB.isOnline, 'boolean');
    assert.strictEqual(blocoB.isOnline, true);

    assert.equal(blocoA.id, 'locker-bloco-a');
    assert.equal(blocoA.code, 'BLOCO-A-01');
    assert.equal(blocoA.totalDoorsCount, 2);
    assert.equal(blocoA.availableDoorsCount, 2);
    assert.equal(typeof blocoA.isOnline, 'boolean');
    assert.strictEqual(blocoA.isOnline, true);

    // Verifica conversão booleana estrita quando is_online = 0
    db.prepare(`UPDATE lockers SET is_online = 0 WHERE id = 'locker-bloco-a'`).run();
    const offlineResponse = await app.inject({
      method: 'GET',
      url: '/api/lockers',
    });
    const offlineBody = offlineResponse.json<ListLockersResponse>();
    const offlineBlocoA = offlineBody.lockers.find((l) => l.id === 'locker-bloco-a');
    assert.ok(offlineBlocoA);
    assert.equal(typeof offlineBlocoA.isOnline, 'boolean');
    assert.strictEqual(offlineBlocoA.isOnline, false);
  });

  it('2. availableDoorsCount deve decrescer exatamente quando portas mudam para RESERVED, OCCUPIED_RENTED, IN_PREPARATION ou MAINTENANCE enquanto totalDoorsCount permanece constante', async () => {
    const transitions: Array<{ doorId: string; status: string; expectedAvailable: number }> = [
      { doorId: 'door-b-01', status: 'RESERVED', expectedAvailable: 3 },
      { doorId: 'door-b-02', status: 'OCCUPIED_RENTED', expectedAvailable: 2 },
      { doorId: 'door-b-03', status: 'IN_PREPARATION', expectedAvailable: 1 },
      { doorId: 'door-b-04', status: 'MAINTENANCE', expectedAvailable: 0 },
    ];

    const updateDoorStmt = db.prepare(`UPDATE doors SET status = ? WHERE id = ?`);

    for (const step of transitions) {
      updateDoorStmt.run(step.status, step.doorId);

      const response = await app.inject({
        method: 'GET',
        url: '/api/lockers',
      });

      assert.equal(response.statusCode, 200);
      const body = response.json<ListLockersResponse>();

      const blocoB = body.lockers.find((l) => l.id === 'locker-bloco-b');
      const blocoA = body.lockers.find((l) => l.id === 'locker-bloco-a');

      assert.ok(blocoB);
      assert.equal(typeof blocoB.totalDoorsCount, 'number');
      assert.equal(typeof blocoB.availableDoorsCount, 'number');
      assert.strictEqual(blocoB.totalDoorsCount, 4);
      assert.strictEqual(blocoB.availableDoorsCount, step.expectedAvailable);

      // Bloco A não sofreu alterações
      assert.ok(blocoA);
      assert.strictEqual(blocoA.totalDoorsCount, 2);
      assert.strictEqual(blocoA.availableDoorsCount, 2);
    }

    // Verifica que o resumo do locker dentro de /catalog reflete os mesmos contadores
    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/api/lockers/locker-bloco-b/catalog',
    });
    assert.equal(catalogResponse.statusCode, 200);
    const catalogBody = catalogResponse.json<LockerCatalogResponse>();
    assert.strictEqual(catalogBody.locker.totalDoorsCount, 4);
    assert.strictEqual(catalogBody.locker.availableDoorsCount, 0);
  });

  it('3. GET /api/lockers/locker-bloco-b/catalog deve retornar portas ordenadas [1, 2, 3, 4], preços em centavos corretos e requiresPreparation booleano (RF17)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/lockers/locker-bloco-b/catalog',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<LockerCatalogResponse>();

    assert.equal(body.locker.id, 'locker-bloco-b');
    assert.strictEqual(body.locker.isOnline, true);
    assert.strictEqual(body.locker.totalDoorsCount, 4);
    assert.strictEqual(body.locker.availableDoorsCount, 4);

    assert.deepEqual(
      body.doors.map((d) => d.doorNumber),
      [1, 2, 3, 4],
    );

    const [door1, door2, door3, door4] = body.doors;

    // Porta 1: Calculadora Científica (requiresPreparation === false)
    assert.equal(door1.id, 'door-b-01');
    assert.equal(door1.status, 'AVAILABLE');
    assert.equal(door1.lockState, 'LOCKED');
    assert.strictEqual(door1.currentRentalId, null);
    assert.strictEqual(door1.currentOccupantName, null);
    assert.strictEqual(door1.currentOccupantRa, null);
    assert.strictEqual(door1.expectedReturnAt, null);
    assert.ok(door1.item);
    assert.equal(door1.item.id, 'itm-01');
    assert.equal(door1.item.sku, 'CALC-CASIO-01');
    assert.strictEqual(door1.item.hourlyPriceCents, 200);
    assert.strictEqual(door1.item.dailyPriceCents, 800);
    assert.equal(typeof door1.item.requiresPreparation, 'boolean');
    assert.strictEqual(door1.item.requiresPreparation, false);
    assert.strictEqual(door1.item.imageUrl, null);

    // Porta 2: Jaleco Manga Longa (requiresPreparation === true - RF17)
    assert.equal(door2.id, 'door-b-02');
    assert.ok(door2.item);
    assert.equal(door2.item.id, 'itm-02');
    assert.equal(door2.item.sku, 'JALECO-LAB-01');
    assert.strictEqual(door2.item.hourlyPriceCents, 400);
    assert.strictEqual(door2.item.dailyPriceCents, 1200);
    assert.equal(typeof door2.item.requiresPreparation, 'boolean');
    assert.strictEqual(door2.item.requiresPreparation, true);

    // Porta 3: Powerbank 10.000mAh (requiresPreparation === true - RF17)
    assert.equal(door3.id, 'door-b-03');
    assert.ok(door3.item);
    assert.equal(door3.item.id, 'itm-03');
    assert.equal(door3.item.sku, 'PWR-BANK-01');
    assert.strictEqual(door3.item.hourlyPriceCents, 300);
    assert.strictEqual(door3.item.dailyPriceCents, 1000);
    assert.equal(typeof door3.item.requiresPreparation, 'boolean');
    assert.strictEqual(door3.item.requiresPreparation, true);

    // Porta 4: Carregador USB-C 65W (requiresPreparation === false)
    assert.equal(door4.id, 'door-b-04');
    assert.ok(door4.item);
    assert.equal(door4.item.id, 'itm-04');
    assert.equal(door4.item.sku, 'CHARGER-65W-01');
    assert.strictEqual(door4.item.hourlyPriceCents, 300);
    assert.strictEqual(door4.item.dailyPriceCents, 1000);
    assert.equal(typeof door4.item.requiresPreparation, 'boolean');
    assert.strictEqual(door4.item.requiresPreparation, false);
  });

  it('4. Quando uma porta possui locação ativa em current_rental_id, o catálogo deve popular currentOccupantName, currentOccupantRa e expectedReturnAt', async () => {
    const rentalId = 'rnt-test-active-01';
    const expectedReturnAt = '2026-10-25T20:30:00.000Z';

    db.prepare(
      `INSERT INTO rentals (
         id, user_id, locker_id, door_id, item_id,
         plan_type, duration_units, total_amount_cents,
         status, reservation_expires_at, paid_at, picked_up_at, expected_return_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rentalId,
      'usr-student-01', // Lucas Andrade (RA: 20261045)
      'locker-bloco-b',
      'door-b-02',
      'itm-02',
      'HOURLY',
      2,
      800,
      'IN_USE',
      '2026-10-25T18:40:00.000Z',
      '2026-10-25T18:29:00.000Z',
      '2026-10-25T18:30:00.000Z',
      expectedReturnAt,
    );

    db.prepare(
      `UPDATE doors
       SET status = 'OCCUPIED_RENTED', current_rental_id = ?
       WHERE id = 'door-b-02'`,
    ).run(rentalId);

    const response = await app.inject({
      method: 'GET',
      url: '/api/lockers/locker-bloco-b/catalog',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<LockerCatalogResponse>();

    const occupiedDoor = body.doors.find((d) => d.id === 'door-b-02');
    assert.ok(occupiedDoor);
    assert.equal(occupiedDoor.status, 'OCCUPIED_RENTED');
    assert.equal(occupiedDoor.currentRentalId, rentalId);
    assert.equal(occupiedDoor.currentOccupantName, 'Lucas Andrade');
    assert.equal(occupiedDoor.currentOccupantRa, '20261045');
    assert.equal(occupiedDoor.expectedReturnAt, expectedReturnAt);

    // Demais portas continuam sem ocupante vinculado
    const availableDoor = body.doors.find((d) => d.id === 'door-b-01');
    assert.ok(availableDoor);
    assert.strictEqual(availableDoor.currentRentalId, null);
    assert.strictEqual(availableDoor.currentOccupantName, null);
    assert.strictEqual(availableDoor.currentOccupantRa, null);
    assert.strictEqual(availableDoor.expectedReturnAt, null);
  });

  it('5. Quando uma porta tem item_id = NULL, door.item deve retornar null sem quebrar o endpoint', async () => {
    db.prepare(`UPDATE doors SET item_id = NULL WHERE id = 'door-b-04'`).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/lockers/locker-bloco-b/catalog',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<LockerCatalogResponse>();
    assert.equal(body.doors.length, 4);

    const emptyDoor = body.doors.find((d) => d.id === 'door-b-04');
    assert.ok(emptyDoor);
    assert.strictEqual(emptyDoor.doorNumber, 4);
    assert.strictEqual(emptyDoor.item, null);

    // Demais portas continuam com seus itens íntegros
    const firstDoor = body.doors.find((d) => d.id === 'door-b-01');
    assert.ok(firstDoor);
    assert.ok(firstDoor.item);
    assert.equal(firstDoor.item.id, 'itm-01');
  });

  it('6. GET /api/lockers/locker-inexistente/catalog deve retornar HTTP 404 com error LOCKER_NOT_FOUND', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/lockers/locker-inexistente/catalog',
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<ApiErrorResponse>();
    assert.equal(body.error, 'LOCKER_NOT_FOUND');
    assert.equal(
      body.message,
      'Armário inteligente não encontrado para o bloco informado.',
    );
  });
});
