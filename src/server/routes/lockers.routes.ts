import type { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { expireOverdueReservations } from '../workers/ttl-worker.js';
import type {
  Locker,
  DoorWithItem,
  CatalogItem,
  DoorStatus,
  LockState,
  ItemCategory,
  ListLockersResponse,
  LockerCatalogResponse,
  ApiErrorResponse,
} from '../../shared/types.js';

interface LockerSummaryRow {
  id: string;
  code: string;
  name: string;
  building_location: string;
  is_online: number;
  total_doors_count: number;
  available_doors_count: number;
}

interface CatalogDoorRow {
  id: string;
  locker_id: string;
  door_number: number;
  status: DoorStatus;
  lock_state: LockState;
  current_rental_id: string | null;
  updated_at: string;
  item_id: string | null;
  item_sku: string | null;
  item_name: string | null;
  item_category: ItemCategory | null;
  item_description: string | null;
  hourly_price_cents: number | null;
  daily_price_cents: number | null;
  requires_preparation: number | null;
  image_url: string | null;
  expected_return_at: string | null;
  occupant_name: string | null;
  occupant_ra: string | null;
}

function mapLockerSummaryRow(row: LockerSummaryRow): Locker {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    buildingLocation: row.building_location,
    isOnline: Boolean(row.is_online),
    totalDoorsCount: Number(row.total_doors_count),
    availableDoorsCount: Number(row.available_doors_count),
  };
}

function mapCatalogDoorRow(row: CatalogDoorRow): DoorWithItem {
  const item: CatalogItem | null = row.item_id
    ? {
        id: row.item_id,
        sku: row.item_sku!,
        name: row.item_name!,
        category: row.item_category!,
        description: row.item_description!,
        hourlyPriceCents: Number(row.hourly_price_cents),
        dailyPriceCents: Number(row.daily_price_cents),
        requiresPreparation: Boolean(row.requires_preparation),
        imageUrl: row.image_url ?? null,
      }
    : null;

  return {
    id: row.id,
    lockerId: row.locker_id,
    doorNumber: Number(row.door_number),
    status: row.status,
    lockState: row.lock_state,
    currentRentalId: row.current_rental_id ?? null,
    currentOccupantName: row.current_rental_id ? (row.occupant_name ?? null) : null,
    currentOccupantRa: row.current_rental_id ? (row.occupant_ra ?? null) : null,
    expectedReturnAt: row.current_rental_id ? (row.expected_return_at ?? null) : null,
    updatedAt: row.updated_at,
    item,
  };
}

/**
 * Rotas de Armários e Catálogo por Ponto de Retirada (RF02, RF11, RF14, RN01)
 * Responsável Exclusivo: Dev 2 (Backend A)
 */
export async function lockersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/lockers
   * Lista todos os armários mantendo a ordem de inserção com contagem de portas totais e disponíveis.
   */
  app.get<{
    Reply: ListLockersResponse;
  }>('/api/lockers', async (_request, reply) => {
    expireOverdueReservations();

    const rows = db
      .prepare(
        `SELECT
           l.id,
           l.code,
           l.name,
           l.building_location,
           l.is_online,
           COUNT(d.id) AS total_doors_count,
           COALESCE(SUM(CASE WHEN d.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_doors_count
         FROM lockers l
         LEFT JOIN doors d ON d.locker_id = l.id
         GROUP BY l.id
         ORDER BY l.rowid ASC`,
      )
      .all() as LockerSummaryRow[];

    const lockers = rows.map(mapLockerSummaryRow);

    return reply.status(200).send({ lockers });
  });

  /**
   * GET /api/lockers/:lockerId/catalog
   * Retorna os metadados do armário e todas as suas portas numeradas em ordem crescente com item e ocupante atual.
   */
  app.get<{
    Params: { lockerId: string };
    Reply: LockerCatalogResponse | ApiErrorResponse;
  }>('/api/lockers/:lockerId/catalog', async (request, reply) => {
    expireOverdueReservations();

    const { lockerId } = request.params;

    const lockerRow = db
      .prepare(
        `SELECT
           l.id,
           l.code,
           l.name,
           l.building_location,
           l.is_online,
           COUNT(d.id) AS total_doors_count,
           COALESCE(SUM(CASE WHEN d.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_doors_count
         FROM lockers l
         LEFT JOIN doors d ON d.locker_id = l.id
         WHERE l.id = ?
         GROUP BY l.id`,
      )
      .get(lockerId) as LockerSummaryRow | undefined;

    if (!lockerRow) {
      return reply.status(404).send({
        error: 'LOCKER_NOT_FOUND',
        message: 'Armário inteligente não encontrado para o bloco informado.',
      });
    }

    const doorRows = db
      .prepare(
        `SELECT
           d.id,
           d.locker_id,
           d.door_number,
           d.status,
           d.lock_state,
           d.current_rental_id,
           d.updated_at,
           i.id AS item_id,
           i.sku AS item_sku,
           i.name AS item_name,
           i.category AS item_category,
           i.description AS item_description,
           i.hourly_price_cents,
           i.daily_price_cents,
           i.requires_preparation,
           i.image_url,
           r.expected_return_at,
           u.name AS occupant_name,
           u.ra AS occupant_ra
         FROM doors d
         LEFT JOIN items i ON d.item_id = i.id
         LEFT JOIN rentals r ON d.current_rental_id = r.id
         LEFT JOIN users u ON r.user_id = u.id
         WHERE d.locker_id = ?
         ORDER BY d.door_number ASC`,
      )
      .all(lockerId) as CatalogDoorRow[];

    const locker = mapLockerSummaryRow(lockerRow);
    const doors = doorRows.map(mapCatalogDoorRow);

    return reply.status(200).send({ locker, doors });
  });
}
