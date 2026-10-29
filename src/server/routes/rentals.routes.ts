import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  CreateRentalRequest,
  CreateRentalResponse,
  GetRentalDetailsResponse,
  ExtendRentalRequest,
  ExtendRentalResponse,
  ReportIssueRequest,
  ReportIssueResponse,
  ApiErrorResponse,
  CancelReason,
  DoorStatus,
  LockState,
  Payment,
  PaymentMethod,
  PaymentStatus,
  PlanType,
  Rental,
  RentalStatus,
} from '../../shared/types.js';
import {
  db,
  findActiveRentalId,
  insertDoorEvent,
  runImmediateTransaction,
} from '../db/connection.js';
import { requireAuthenticatedUser } from '../db/auth-helper.js';
import { buildMockPixQrSvg, buildPixCopyPastePayload } from '../db/pix-mock.js';
import { expireOverdueReservations } from '../workers/ttl-worker.js';
import {
  broadcastCatalogStockUpdated,
  sendDoorUnlockCommand,
  sendRentalStatusUpdated,
} from '../ws/broker.js';

const RESERVATION_TTL_MS = 10 * 60_000; // 10 minutos (RF04 / RF16)
const INSPECTION_WINDOW_MS = 120_000; // 2 minutos (RF10)
const MAX_ISSUE_NOTES_LENGTH = 500;

interface DoorJoinRow {
  door_id: string;
  locker_id: string;
  door_number: number;
  door_status: DoorStatus;
  lock_state: LockState;
  locker_name: string;
  building_location: string;
  item_id: string | null;
  item_sku: string | null;
  item_name: string | null;
  hourly_price_cents: number | null;
  daily_price_cents: number | null;
}

interface HydratedRentalRow {
  rental_id: string;
  user_id: string;
  user_name: string;
  user_ra: string;
  locker_id: string;
  locker_name: string;
  building_location: string;
  door_id: string;
  door_number: number;
  door_status: DoorStatus;
  door_lock_state: LockState;
  item_id: string;
  item_name: string;
  item_sku: string;
  hourly_price_cents: number;
  daily_price_cents: number;
  plan_type: PlanType;
  duration_units: number;
  total_amount_cents: number;
  status: RentalStatus;
  cancel_reason: CancelReason | null;
  issue_notes: string | null;
  reservation_expires_at: string;
  paid_at: string | null;
  first_unlocked_at: string | null;
  picked_up_at: string | null;
  expected_return_at: string | null;
  returned_at: string | null;
  created_at: string;
  payment_id: string | null;
  payment_amount_cents: number | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus | null;
  pix_copy_paste: string | null;
  pix_qr_svg: string | null;
  payment_paid_at: string | null;
  payment_created_at: string | null;
}

interface HydratedRentalBundle {
  rental: Rental;
  payment: Payment | null;
  doorStatus: DoorStatus;
  doorLockState: LockState;
  hourlyPriceCents: number;
  dailyPriceCents: number;
}

function isValidPlanType(value: unknown): value is PlanType {
  return value === 'HOURLY' || value === 'DAILY';
}

const HOURS_PER_DAY = 24;

/**
 * Soma a prorrogação ao contrato mantendo `duration_units` na unidade de `plan_type`, de modo que
 * a duração contratada sempre corresponda ao prazo. Misturar diária com hora converte o contrato
 * para horas, a única unidade que representa as duas.
 */
function extendContract(
  current: { planType: PlanType; durationUnits: number },
  extension: { planType: PlanType; additionalUnits: number },
): { planType: PlanType; durationUnits: number } {
  if (current.planType === extension.planType) {
    return {
      planType: current.planType,
      durationUnits: current.durationUnits + extension.additionalUnits,
    };
  }
  const toHours = (planType: PlanType, units: number) =>
    planType === 'DAILY' ? units * HOURS_PER_DAY : units;
  return {
    planType: 'HOURLY',
    durationUnits:
      toHours(current.planType, current.durationUnits) +
      toHours(extension.planType, extension.additionalUnits),
  };
}

function getHydratedRentalById(rentalId: string): HydratedRentalBundle | null {
  const row = db
    .prepare(
      `SELECT
         r.id AS rental_id,
         r.user_id,
         u.name AS user_name,
         u.ra AS user_ra,
         r.locker_id,
         l.name AS locker_name,
         l.building_location,
         r.door_id,
         d.door_number,
         d.status AS door_status,
         d.lock_state AS door_lock_state,
         r.item_id,
         i.name AS item_name,
         i.sku AS item_sku,
         i.hourly_price_cents,
         i.daily_price_cents,
         r.plan_type,
         r.duration_units,
         r.total_amount_cents,
         r.status,
         r.cancel_reason,
         r.issue_notes,
         r.reservation_expires_at,
         r.paid_at,
         r.first_unlocked_at,
         r.picked_up_at,
         r.expected_return_at,
         r.returned_at,
         r.created_at,
         p.id AS payment_id,
         p.amount_cents AS payment_amount_cents,
         p.method AS payment_method,
         p.status AS payment_status,
         p.pix_copy_paste,
         p.pix_qr_svg,
         p.paid_at AS payment_paid_at,
         p.created_at AS payment_created_at
       FROM rentals r
       JOIN users u ON r.user_id = u.id
       JOIN lockers l ON r.locker_id = l.id
       JOIN doors d ON r.door_id = d.id
       JOIN items i ON r.item_id = i.id
       LEFT JOIN payments p ON p.rental_id = r.id
       WHERE r.id = ?`,
    )
    .get(rentalId) as HydratedRentalRow | undefined;

  if (!row) return null;

  const rental: Rental = {
    id: row.rental_id,
    userId: row.user_id,
    userName: row.user_name,
    userRa: row.user_ra,
    lockerId: row.locker_id,
    lockerName: row.locker_name,
    buildingLocation: row.building_location,
    doorId: row.door_id,
    doorNumber: row.door_number,
    doorLockState: row.door_lock_state,
    itemId: row.item_id,
    itemName: row.item_name,
    itemSku: row.item_sku,
    planType: row.plan_type,
    durationUnits: row.duration_units,
    totalAmountCents: row.total_amount_cents,
    status: row.status,
    cancelReason: row.cancel_reason ?? null,
    issueNotes: row.issue_notes ?? null,
    reservationExpiresAt: row.reservation_expires_at,
    paidAt: row.paid_at ?? null,
    firstUnlockedAt: row.first_unlocked_at ?? null,
    pickedUpAt: row.picked_up_at ?? null,
    expectedReturnAt: row.expected_return_at ?? null,
    returnedAt: row.returned_at ?? null,
    createdAt: row.created_at,
  };

  const payment: Payment | null = row.payment_id
    ? {
        id: row.payment_id,
        rentalId: row.rental_id,
        amountCents: row.payment_amount_cents ?? row.total_amount_cents,
        method: row.payment_method ?? 'PIX_MOCK',
        status: row.payment_status ?? 'PENDING',
        pixCopyPaste: row.pix_copy_paste ?? '',
        pixQrSvg: row.pix_qr_svg ?? null,
        paidAt: row.payment_paid_at ?? null,
        createdAt: row.payment_created_at ?? row.created_at,
      }
    : null;

  return {
    rental,
    payment,
    doorStatus: row.door_status,
    doorLockState: row.door_lock_state,
    hourlyPriceCents: row.hourly_price_cents,
    dailyPriceCents: row.daily_price_cents,
  };
}

/**
 * Rotas Comerciais de Locação: Reserva, Consulta, Prorrogação e Vistoria (RF03, RF04, RF07, RF09, RF10)
 * Responsável Exclusivo: Dev 2 (Backend A — Cards BE1-04 e BE1-05)
 *
 * NOTA DE ARQUITETURA:
 * Os comandos físicos de abertura (`/unlock` e `/return-unlock`) ficam em `unlock.routes.ts` (Dev 3)
 * para garantir zero conflito de Git entre Dev 2 e Dev 3.
 */
export async function rentalsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/rentals — Criação de Reserva Antecipada com Bloqueio Atômico (RF03, RF04, RN01, RN02, RNF05)
   */
  app.post<{
    Body: CreateRentalRequest;
    Reply: CreateRentalResponse | ApiErrorResponse;
  }>('/api/rentals', async (request, reply) => {
    const authUser = requireAuthenticatedUser(request, reply);
    if (!authUser) return;

    const doorId = typeof request.body?.doorId === 'string' ? request.body.doorId.trim() : '';
    const planType = request.body?.planType;
    const durationUnits = request.body?.durationUnits;

    if (
      !doorId ||
      !isValidPlanType(planType) ||
      typeof durationUnits !== 'number' ||
      !Number.isInteger(durationUnits) ||
      durationUnits < 1 ||
      durationUnits > 30
    ) {
      return reply.status(400).send({
        error: 'INVALID_RENTAL_INPUT',
        message:
          'Informe doorId válido, planType (HOURLY ou DAILY) e durationUnits inteiro entre 1 e 30.',
      });
    }

    // Libera imediatamente reservas anteriores cujo TTL já venceu antes de verificar estoque
    expireOverdueReservations();

    type CreateTxResult =
      | { kind: 'DOOR_NOT_FOUND' }
      | { kind: 'DOOR_WITHOUT_ITEM' }
      | { kind: 'USER_HAS_ACTIVE_RENTAL' }
      | { kind: 'DOOR_NOT_AVAILABLE' }
      | {
          kind: 'CREATED';
          rental: Rental;
          payment: Payment;
          doorLockState: LockState;
        };

    const txResult = runImmediateTransaction<CreateTxResult>(() => {
      const now = new Date();
      const doorRow = db
        .prepare(
          `SELECT
             d.id AS door_id,
             d.locker_id,
             d.door_number,
             d.status AS door_status,
             d.lock_state,
             l.name AS locker_name,
             l.building_location,
             i.id AS item_id,
             i.sku AS item_sku,
             i.name AS item_name,
             i.hourly_price_cents,
             i.daily_price_cents
           FROM doors d
           JOIN lockers l ON d.locker_id = l.id
           LEFT JOIN items i ON d.item_id = i.id
           WHERE d.id = ?`,
        )
        .get(doorId) as DoorJoinRow | undefined;

      if (!doorRow) {
        return { kind: 'DOOR_NOT_FOUND' };
      }

      if (
        !doorRow.item_id ||
        !doorRow.item_name ||
        doorRow.hourly_price_cents === null ||
        doorRow.daily_price_cents === null
      ) {
        return { kind: 'DOOR_WITHOUT_ITEM' };
      }

      // Uma locação ativa por aluno: o login devolve um único activeRentalId, e reservar sem pagar
      // não pode servir para segurar várias portas ao mesmo tempo
      if (findActiveRentalId(authUser.id, now.toISOString())) {
        return { kind: 'USER_HAS_ACTIVE_RENTAL' };
      }

      // RN02: Bloqueio atômico contra dupla locação
      if (doorRow.door_status !== 'AVAILABLE') {
        return { kind: 'DOOR_NOT_AVAILABLE' };
      }

      const unitPriceCents =
        planType === 'HOURLY' ? doorRow.hourly_price_cents : doorRow.daily_price_cents;
      const totalAmountCents = unitPriceCents * durationUnits;

      const createdAt = now.toISOString();
      const reservationExpiresAt = new Date(
        now.getTime() + RESERVATION_TTL_MS,
      ).toISOString();

      const rentalId = `rnt-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const paymentId = `pay-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const pixCopyPaste = buildPixCopyPastePayload(rentalId, totalAmountCents);
      const pixQrSvg = buildMockPixQrSvg(rentalId);

      // Defesa dupla RN02: garante que a porta continua AVAILABLE no exato UPDATE
      const doorUpdate = db
        .prepare(
          `UPDATE doors
           SET status = 'RESERVED',
               current_rental_id = ?,
               updated_at = ?
           WHERE id = ? AND status = 'AVAILABLE'`,
        )
        .run(rentalId, createdAt, doorRow.door_id);

      if (doorUpdate.changes !== 1) {
        return { kind: 'DOOR_NOT_AVAILABLE' };
      }

      db.prepare(
        `INSERT INTO rentals (
           id, user_id, locker_id, door_id, item_id,
           plan_type, duration_units, total_amount_cents,
           status, reservation_expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_PAYMENT', ?, ?)`,
      ).run(
        rentalId,
        authUser.id,
        doorRow.locker_id,
        doorRow.door_id,
        doorRow.item_id,
        planType,
        durationUnits,
        totalAmountCents,
        reservationExpiresAt,
        createdAt,
      );

      db.prepare(
        `INSERT INTO payments (
           id, rental_id, amount_cents, method, status, pix_copy_paste, pix_qr_svg, created_at
         ) VALUES (?, ?, ?, 'PIX_MOCK', 'PENDING', ?, ?, ?)`,
      ).run(paymentId, rentalId, totalAmountCents, pixCopyPaste, pixQrSvg, createdAt);

      insertDoorEvent({
        doorId: doorRow.door_id,
        rentalId,
        userId: authUser.id,
        eventType: 'STATUS_CHANGE',
        createdAt,
        details: {
          from: 'AVAILABLE',
          to: 'RESERVED',
          planType,
          durationUnits,
          totalAmountCents,
        },
      });

      const rental: Rental = {
        id: rentalId,
        userId: authUser.id,
        userName: authUser.name,
        userRa: authUser.ra,
        lockerId: doorRow.locker_id,
        lockerName: doorRow.locker_name,
        buildingLocation: doorRow.building_location,
        doorId: doorRow.door_id,
        doorNumber: doorRow.door_number,
        doorLockState: doorRow.lock_state,
        itemId: doorRow.item_id,
        itemName: doorRow.item_name,
        itemSku: doorRow.item_sku ?? undefined,
        planType,
        durationUnits,
        totalAmountCents,
        status: 'AWAITING_PAYMENT',
        cancelReason: null,
        issueNotes: null,
        reservationExpiresAt,
        paidAt: null,
        firstUnlockedAt: null,
        pickedUpAt: null,
        expectedReturnAt: null,
        returnedAt: null,
        createdAt,
      };

      const payment: Payment = {
        id: paymentId,
        rentalId,
        amountCents: totalAmountCents,
        method: 'PIX_MOCK',
        status: 'PENDING',
        pixCopyPaste,
        pixQrSvg,
        paidAt: null,
        createdAt,
      };

      return {
        kind: 'CREATED',
        rental,
        payment,
        doorLockState: doorRow.lock_state,
      };
    });

    if (txResult.kind === 'DOOR_NOT_FOUND') {
      return reply.status(404).send({
        error: 'DOOR_NOT_FOUND',
        message: 'Porta não encontrada no armário selecionado.',
      });
    }

    if (txResult.kind === 'DOOR_WITHOUT_ITEM') {
      return reply.status(409).send({
        error: 'DOOR_WITHOUT_ITEM',
        message: 'Esta porta não possui nenhum objeto vinculado para locação.',
      });
    }

    if (txResult.kind === 'USER_HAS_ACTIVE_RENTAL') {
      return reply.status(409).send({
        error: 'USER_HAS_ACTIVE_RENTAL',
        message:
          'Você já tem uma locação em andamento. Conclua ou cancele a atual antes de reservar outro objeto.',
      });
    }

    if (txResult.kind === 'DOOR_NOT_AVAILABLE') {
      return reply.status(409).send({
        error: 'DOOR_NOT_AVAILABLE',
        message:
          'Ops! Este objeto acabou de ser reservado por outro colega. Escolha outra porta disponível.',
      });
    }

    broadcastCatalogStockUpdated({
      lockerId: txResult.rental.lockerId,
      door: {
        id: txResult.rental.doorId,
        doorNumber: txResult.rental.doorNumber,
        status: 'RESERVED',
        lockState: txResult.doorLockState,
        currentRentalId: txResult.rental.id,
        currentOccupantName: authUser.name,
        expectedReturnAt: null,
      },
    });

    return reply.status(201).send({
      rental: txResult.rental,
      payment: txResult.payment,
    });
  });

  /**
   * GET /api/rentals/:rentalId — Painel de Locação Ativa e Cronômetro (RF07, RNF05)
   */
  app.get<{
    Params: { rentalId: string };
    Reply: GetRentalDetailsResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId', async (request, reply) => {
    const authUser = requireAuthenticatedUser(request, reply);
    if (!authUser) return;

    expireOverdueReservations();

    const rentalId = request.params.rentalId?.trim();
    const hydrated = rentalId ? getHydratedRentalById(rentalId) : null;

    if (!hydrated) {
      return reply.status(404).send({
        error: 'RENTAL_NOT_FOUND',
        message: 'Locação não encontrada.',
      });
    }

    // RNF05: Impede acesso cruzado (IDOR) entre estudantes distintos
    if (hydrated.rental.userId !== authUser.id && authUser.role !== 'ADMIN') {
      return reply.status(403).send({
        error: 'FORBIDDEN_RENTAL_ACCESS',
        message: 'Acesso negado: esta locação pertence a outro estudante.',
      });
    }

    return reply.status(200).send({
      rental: hydrated.rental,
      payment: hydrated.payment,
    });
  });

  /**
   * POST /api/rentals/:rentalId/extend — Prorrogação de Horário (RF09 - Extra, RNF05)
   */
  app.post<{
    Params: { rentalId: string };
    Body: ExtendRentalRequest;
    Reply: ExtendRentalResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/extend', async (request, reply) => {
    const authUser = requireAuthenticatedUser(request, reply);
    if (!authUser) return;

    const rentalId = request.params.rentalId?.trim();
    const planType = request.body?.planType;
    const additionalUnits = request.body?.additionalUnits;

    if (
      !rentalId ||
      !isValidPlanType(planType) ||
      typeof additionalUnits !== 'number' ||
      !Number.isInteger(additionalUnits) ||
      additionalUnits < 1 ||
      additionalUnits > 30
    ) {
      return reply.status(400).send({
        error: 'INVALID_EXTEND_INPUT',
        message:
          'Informe planType (HOURLY ou DAILY) e additionalUnits inteiro entre 1 e 30 para prorrogar.',
      });
    }

    type ExtendTxResult =
      | { kind: 'NOT_FOUND' }
      | { kind: 'FORBIDDEN' }
      | { kind: 'NOT_IN_USE'; currentStatus: RentalStatus }
      | { kind: 'RESTRICTED' }
      | {
          kind: 'EXTENDED';
          bundle: HydratedRentalBundle;
          addedAmountCents: number;
        };

    const outcome = runImmediateTransaction<ExtendTxResult>(() => {
      const current = getHydratedRentalById(rentalId);
      if (!current) {
        return { kind: 'NOT_FOUND' };
      }

      if (current.rental.userId !== authUser.id && authUser.role !== 'ADMIN') {
        return { kind: 'FORBIDDEN' };
      }

      if (current.rental.status !== 'IN_USE') {
        return { kind: 'NOT_IN_USE', currentStatus: current.rental.status };
      }

      // SPEC RF09 Cenário 2: verifica bloqueio de manutenção ou reserva subsequente na porta
      const conflictingRow = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM rentals
           WHERE door_id = ?
             AND id != ?
             AND status IN ('CREATED', 'AWAITING_PAYMENT', 'PAID_READY_FOR_PICKUP')`,
        )
        .get(current.rental.doorId, rentalId) as { count: number };

      if (
        current.doorStatus === 'MAINTENANCE' ||
        current.doorStatus === 'IN_PREPARATION' ||
        conflictingRow.count > 0
      ) {
        return { kind: 'RESTRICTED' };
      }

      const addedMs =
        planType === 'HOURLY'
          ? additionalUnits * 3_600_000
          : additionalUnits * 24 * 3_600_000;

      const baseMs = current.rental.expectedReturnAt
        ? Date.parse(current.rental.expectedReturnAt)
        : Date.now();
      const safeBaseMs = Number.isNaN(baseMs) ? Date.now() : baseMs;
      const newExpectedReturnAt = new Date(safeBaseMs + addedMs).toISOString();

      const unitPriceCents =
        planType === 'HOURLY' ? current.hourlyPriceCents : current.dailyPriceCents;
      const addedAmountCents = unitPriceCents * additionalUnits;
      const newTotalAmountCents = current.rental.totalAmountCents + addedAmountCents;
      const contract = extendContract(current.rental, { planType, additionalUnits });

      // `payments` guarda só o PIX realmente pago na reserva; o acréscimo fica em `total_amount_cents`
      db.prepare(
        `UPDATE rentals
         SET expected_return_at = ?,
             total_amount_cents = ?,
             plan_type = ?,
             duration_units = ?
         WHERE id = ?`,
      ).run(
        newExpectedReturnAt,
        newTotalAmountCents,
        contract.planType,
        contract.durationUnits,
        rentalId,
      );

      insertDoorEvent({
        doorId: current.rental.doorId,
        rentalId,
        userId: authUser.id,
        eventType: 'STATUS_CHANGE',
        details: {
          action: 'RENTAL_EXTENDED',
          planType,
          additionalUnits,
          addedAmountCents,
          newExpectedReturnAt,
        },
      });

      const updated = getHydratedRentalById(rentalId)!;
      return {
        kind: 'EXTENDED',
        bundle: updated,
        addedAmountCents,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return reply.status(404).send({
        error: 'RENTAL_NOT_FOUND',
        message: 'Locação não encontrada.',
      });
    }

    if (outcome.kind === 'FORBIDDEN') {
      return reply.status(403).send({
        error: 'FORBIDDEN_RENTAL_ACCESS',
        message: 'Você não tem permissão para prorrogar a locação de outro estudante.',
      });
    }

    if (outcome.kind === 'NOT_IN_USE') {
      return reply.status(409).send({
        error: 'RENTAL_NOT_IN_USE',
        message: `Apenas locações em uso podem ser prorrogadas (status atual: '${outcome.currentStatus}').`,
      });
    }

    if (outcome.kind === 'RESTRICTED') {
      return reply.status(409).send({
        error: 'EXTENSION_RESTRICTED',
        message:
          'Este item não pode ser prorrogado devido a bloqueio de manutenção ou reserva agendada e deve ser devolvido no horário original.',
      });
    }

    const { rental, doorStatus, doorLockState } = outcome.bundle;
    const inspectionWindowEndsAt = rental.firstUnlockedAt
      ? new Date(Date.parse(rental.firstUnlockedAt) + INSPECTION_WINDOW_MS).toISOString()
      : null;

    sendRentalStatusUpdated(rental.userId, {
      rentalId: rental.id,
      status: rental.status,
      doorId: rental.doorId,
      doorNumber: rental.doorNumber,
      doorStatus,
      lockState: doorLockState,
      paidAt: rental.paidAt ?? null,
      pickedUpAt: rental.pickedUpAt ?? null,
      expectedReturnAt: rental.expectedReturnAt ?? null,
      inspectionWindowEndsAt,
    });

    broadcastCatalogStockUpdated({
      lockerId: rental.lockerId,
      door: {
        id: rental.doorId,
        doorNumber: rental.doorNumber,
        status: doorStatus,
        lockState: doorLockState,
        currentRentalId: rental.id,
        currentOccupantName: rental.userName ?? null,
        expectedReturnAt: rental.expectedReturnAt ?? null,
      },
    });

    return reply.status(200).send({
      success: true,
      rental,
      addedAmountCents: outcome.addedAmountCents,
      message: 'Prazo da locação prorrogado com sucesso!',
    });
  });

  /**
   * POST /api/rentals/:rentalId/report-issue — Vistoria Expressa em 2 Minutos (RF10 - Extra, RNF05)
   */
  app.post<{
    Params: { rentalId: string };
    Body: ReportIssueRequest;
    Reply: ReportIssueResponse | ApiErrorResponse;
  }>('/api/rentals/:rentalId/report-issue', async (request, reply) => {
    const authUser = requireAuthenticatedUser(request, reply);
    if (!authUser) return;

    const rentalId = request.params.rentalId?.trim();
    const issueNotes =
      typeof request.body?.issueNotes === 'string' ? request.body.issueNotes.trim() : '';

    if (!rentalId || !issueNotes) {
      return reply.status(400).send({
        error: 'INVALID_ISSUE_NOTES',
        message: 'Descreva o defeito ou avaria observada no objeto para registrar a vistoria.',
      });
    }

    if (issueNotes.length > MAX_ISSUE_NOTES_LENGTH) {
      return reply.status(400).send({
        error: 'INVALID_ISSUE_NOTES',
        message: `Descreva o defeito em até ${MAX_ISSUE_NOTES_LENGTH} caracteres.`,
      });
    }

    type ReportIssueTxResult =
      | { kind: 'NOT_FOUND' }
      | { kind: 'FORBIDDEN' }
      | { kind: 'ALREADY_CLOSED'; currentStatus: RentalStatus }
      | { kind: 'RETURN_IN_PROGRESS' }
      | { kind: 'NOT_UNLOCKED_YET' }
      | { kind: 'WINDOW_EXPIRED' }
      | {
          kind: 'CANCELLED_AND_REFUNDED';
          rentalId: string;
          userId: string;
          lockerId: string;
          doorId: string;
          doorNumber: number;
          itemName: string;
          wasLocked: boolean;
          paidAt: string | null;
          pickedUpAt: string | null;
          cancelledAt: string;
        };

    const outcome = runImmediateTransaction<ReportIssueTxResult>(() => {
      const current = getHydratedRentalById(rentalId);
      if (!current) {
        return { kind: 'NOT_FOUND' };
      }

      if (current.rental.userId !== authUser.id && authUser.role !== 'ADMIN') {
        return { kind: 'FORBIDDEN' };
      }

      if (
        current.rental.status === 'CANCELLED' ||
        current.rental.status === 'COMPLETED'
      ) {
        return { kind: 'ALREADY_CLOSED', currentStatus: current.rental.status };
      }

      // Pela máquina de estados da SPEC, a vistoria só cancela a partir de EmUso (ou da porta
      // aberta na retirada); com a devolução iniciada, o contrato segue para Concluida
      if (current.rental.status === 'AWAITING_RETURN_CLOSE') {
        return { kind: 'RETURN_IN_PROGRESS' };
      }

      if (
        !current.rental.firstUnlockedAt ||
        (current.rental.status !== 'PAID_READY_FOR_PICKUP' &&
          current.rental.status !== 'IN_USE')
      ) {
        return { kind: 'NOT_UNLOCKED_YET' };
      }

      const nowMs = Date.now();
      const firstUnlockedMs = Date.parse(current.rental.firstUnlockedAt);
      if (
        Number.isNaN(firstUnlockedMs) ||
        nowMs - firstUnlockedMs > INSPECTION_WINDOW_MS
      ) {
        return { kind: 'WINDOW_EXPIRED' };
      }

      const nowIso = new Date(nowMs).toISOString();
      const wasLocked = current.doorLockState === 'LOCKED';

      db.prepare(
        `UPDATE rentals
         SET status = 'CANCELLED',
             cancel_reason = 'ISSUE_REPORTED',
             issue_notes = ?,
             returned_at = ?
         WHERE id = ?`,
      ).run(issueNotes, nowIso, rentalId);

      db.prepare(
        `UPDATE payments
         SET status = 'REFUNDED'
         WHERE rental_id = ?`,
      ).run(rentalId);

      // Destrava a porta (caso já tenha fechado) para devolução do item avariado e coloca em MAINTENANCE
      db.prepare(
        `UPDATE doors
         SET status = 'MAINTENANCE',
             lock_state = 'UNLOCKED',
             current_rental_id = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).run(nowIso, current.rental.doorId);

      insertDoorEvent({
        doorId: current.rental.doorId,
        rentalId,
        userId: authUser.id,
        eventType: 'STATUS_CHANGE',
        createdAt: nowIso,
        details: {
          from: current.doorStatus,
          to: 'MAINTENANCE',
          reason: 'ISSUE_REPORTED',
          issueNotes,
        },
      });

      if (wasLocked) {
        insertDoorEvent({
          doorId: current.rental.doorId,
          rentalId,
          userId: authUser.id,
          eventType: 'UNLOCK_RETURN',
          createdAt: nowIso,
          details: {
            context: 'ISSUE_REPORTED_RETURN',
          },
        });
      }

      return {
        kind: 'CANCELLED_AND_REFUNDED',
        rentalId,
        userId: current.rental.userId,
        lockerId: current.rental.lockerId,
        doorId: current.rental.doorId,
        doorNumber: current.rental.doorNumber,
        itemName: current.rental.itemName,
        wasLocked,
        paidAt: current.rental.paidAt ?? null,
        pickedUpAt: current.rental.pickedUpAt ?? null,
        cancelledAt: nowIso,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return reply.status(404).send({
        error: 'RENTAL_NOT_FOUND',
        message: 'Locação não encontrada.',
      });
    }

    if (outcome.kind === 'FORBIDDEN') {
      return reply.status(403).send({
        error: 'FORBIDDEN_RENTAL_ACCESS',
        message: 'Você não tem permissão para reportar vistoria na locação de outro estudante.',
      });
    }

    if (outcome.kind === 'ALREADY_CLOSED') {
      return reply.status(409).send({
        error: 'RENTAL_ALREADY_CLOSED',
        message: `Esta locação já está encerrada com status '${outcome.currentStatus}'.`,
      });
    }

    if (outcome.kind === 'RETURN_IN_PROGRESS') {
      return reply.status(409).send({
        error: 'RENTAL_RETURN_IN_PROGRESS',
        message:
          'A devolução desta locação já começou. A vistoria expressa não está mais disponível.',
      });
    }

    if (outcome.kind === 'NOT_UNLOCKED_YET') {
      return reply.status(400).send({
        error: 'RENTAL_NOT_UNLOCKED_YET',
        message:
          'A vistoria expressa de 2 minutos só pode ser acionada após a abertura inicial da porta.',
      });
    }

    if (outcome.kind === 'WINDOW_EXPIRED') {
      return reply.status(400).send({
        error: 'INSPECTION_WINDOW_EXPIRED',
        message:
          'O prazo de 2 minutos da Vistoria Expressa para cancelamento gratuito já expirou.',
      });
    }

    // Se a porta já havia sido fechada após a retirada, envia comando WS de abertura para devolução imediata
    if (outcome.wasLocked) {
      sendDoorUnlockCommand({
        lockerId: outcome.lockerId,
        doorId: outcome.doorId,
        doorNumber: outcome.doorNumber,
        lockState: 'UNLOCKED',
        actionContext: 'RETURN',
        rentalId: outcome.rentalId,
        itemName: outcome.itemName,
        triggeredBy: {
          userId: authUser.id,
          userName: authUser.name,
          role: authUser.role,
        },
        playSoundEffect: true,
      });
    }

    broadcastCatalogStockUpdated({
      lockerId: outcome.lockerId,
      door: {
        id: outcome.doorId,
        doorNumber: outcome.doorNumber,
        status: 'MAINTENANCE',
        lockState: 'UNLOCKED',
        currentRentalId: null,
        currentOccupantName: null,
        expectedReturnAt: null,
      },
    });

    sendRentalStatusUpdated(outcome.userId, {
      rentalId: outcome.rentalId,
      status: 'CANCELLED',
      doorId: outcome.doorId,
      doorNumber: outcome.doorNumber,
      doorStatus: 'MAINTENANCE',
      lockState: 'UNLOCKED',
      paidAt: outcome.paidAt,
      pickedUpAt: outcome.pickedUpAt,
      returnedAt: outcome.cancelledAt,
    });

    return reply.status(200).send({
      success: true,
      rentalId: outcome.rentalId,
      rentalStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      doorStatus: 'MAINTENANCE',
      message:
        'Problema reportado na vistoria! Pagamento estornado e porta liberada para devolução e bloqueada para manutenção.',
    });
  });
}
