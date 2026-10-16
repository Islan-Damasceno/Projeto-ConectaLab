import type {
  QuickLoginRequest,
  QuickLoginResponse,
  ListLockersResponse,
  LockerCatalogResponse,
  CreateRentalRequest,
  CreateRentalResponse,
  GetRentalDetailsResponse,
  PixMockWebhookResponse,
  UnlockRentalResponse,
  ReturnUnlockRentalResponse,
  ExtendRentalRequest,
  ExtendRentalResponse,
  ReportIssueRequest,
  ReportIssueResponse,
  AdminDashboardSummaryResponse,
  AdminMasterUnlockResponse,
  AdminUpdateDoorStatusResponse,
  DoorStatus,
  Locker,
  DoorWithItem,
  Rental,
  Payment,
  DoorEventLog,
  WsEnvelope,
  WsEventName,
  WsEventPayloadMap,
} from '../../shared/types.js';

/**
 * ConectaLab — Cliente HTTP Unificado com Suporte a Mock Reativo (USE_MOCK)
 * Responsável Exclusivo: Dev 1 (Frontend)
 *
 * COMO FUNCIONA O MODO MOCK PARA DESTRAVAR O DEV 1:
 * - Quando `USE_MOCK` está ativo (padrão inicial enquanto Dev 2 e Dev 3 codam as rotas),
 *   todas as funções abaixo operam sobre um banco em memória persistido no `localStorage`
 *   e emitem eventos em tempo real entre abas via `BroadcastChannel('conectalab_mock_ws')`.
 * - Para integrar com o Backend Real dos Devs 2 e 3, basta definir `USE_MOCK = false`
 *   ou executar `localStorage.setItem('CONECTALAB_USE_MOCK', 'false')`.
 */
export const DEFAULT_USE_MOCK = true;

const MOCK_STORAGE_KEY = 'CONECTALAB_MOCK_DB_V1';
const MOCK_FLAG_KEY = 'CONECTALAB_USE_MOCK';
const SESSION_USER_KEY = 'CONECTALAB_SESSION_USER';
const SESSION_TOKEN_KEY = 'CONECTALAB_SESSION_TOKEN';
export const MOCK_WS_CHANNEL_NAME = 'conectalab_mock_ws';

export function isUsingMockApi(): boolean {
  const override = localStorage.getItem(MOCK_FLAG_KEY);
  if (override === 'true') return true;
  if (override === 'false') return false;
  return DEFAULT_USE_MOCK;
}

export function setUseMockApi(useMock: boolean): void {
  localStorage.setItem(MOCK_FLAG_KEY, String(useMock));
}

// ============================================================================
// DADOS MOCKADOS FIÉIS AO ADT.md (SEEDS INICIAIS)
// ============================================================================

interface MockDatabaseState {
  lockers: Locker[];
  doors: DoorWithItem[];
  rentals: Record<string, Rental>;
  payments: Record<string, Payment>;
  events: DoorEventLog[];
}

function createInitialMockDatabase(): MockDatabaseState {
  const lockers: Locker[] = [
    {
      id: 'locker-bloco-b',
      code: 'BLOCO-B-01',
      name: 'Armário Bloco B — Laboratórios e Saúde',
      buildingLocation: 'Corredor Principal Térreo (Ao lado do Lab. Química)',
      isOnline: true,
      totalDoorsCount: 4,
      availableDoorsCount: 4,
    },
    {
      id: 'locker-bloco-a',
      code: 'BLOCO-A-01',
      name: 'Armário Bloco A — Engenharias e Exatas',
      buildingLocation: 'Hall dos Elevadores 1º Andar',
      isOnline: true,
      totalDoorsCount: 2,
      availableDoorsCount: 2,
    },
  ];

  const doors: DoorWithItem[] = [
    {
      id: 'door-b-01',
      lockerId: 'locker-bloco-b',
      doorNumber: 1,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-01',
        sku: 'CALC-CASIO-01',
        name: 'Calculadora Científica Casio fx-82MS',
        category: 'EXATAS',
        description: '240 funções, aprovada para provas de Engenharia e Cálculo.',
        hourlyPriceCents: 200,
        dailyPriceCents: 800,
        requiresPreparation: false,
      },
    },
    {
      id: 'door-b-02',
      lockerId: 'locker-bloco-b',
      doorNumber: 2,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-02',
        sku: 'JALECO-LAB-01',
        name: 'Jaleco Manga Longa Branco (Tam. M/G)',
        category: 'SAUDE',
        description: '100% algodão com punho elástico para aulas de laboratório.',
        hourlyPriceCents: 400,
        dailyPriceCents: 1200,
        requiresPreparation: true,
      },
    },
    {
      id: 'door-b-03',
      lockerId: 'locker-bloco-b',
      doorNumber: 3,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-03',
        sku: 'PWR-BANK-01',
        name: 'Powerbank 10.000mAh Turbo Fast Charge',
        category: 'ENERGIA',
        description: 'Cabos USB-C e Lightning integrados. Carga completa.',
        hourlyPriceCents: 300,
        dailyPriceCents: 1000,
        requiresPreparation: true,
      },
    },
    {
      id: 'door-b-04',
      lockerId: 'locker-bloco-b',
      doorNumber: 4,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-04',
        sku: 'CHARGER-65W-01',
        name: 'Carregador Rápido USB-C GaN 65W',
        category: 'ENERGIA',
        description: 'Compatível com notebooks USB-C e smartphones.',
        hourlyPriceCents: 300,
        dailyPriceCents: 1000,
        requiresPreparation: false,
      },
    },
    {
      id: 'door-a-01',
      lockerId: 'locker-bloco-a',
      doorNumber: 1,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-05',
        sku: 'CALC-CASIO-02',
        name: 'Calculadora Científica Casio fx-82MS #2',
        category: 'EXATAS',
        description: '240 funções, bateria revisada.',
        hourlyPriceCents: 200,
        dailyPriceCents: 800,
        requiresPreparation: false,
      },
    },
    {
      id: 'door-a-02',
      lockerId: 'locker-bloco-a',
      doorNumber: 2,
      status: 'AVAILABLE',
      lockState: 'LOCKED',
      item: {
        id: 'itm-06',
        sku: 'PWR-BANK-02',
        name: 'Powerbank 10.000mAh Turbo #2',
        category: 'ENERGIA',
        description: 'Cabos USB-C e Lightning integrados.',
        hourlyPriceCents: 300,
        dailyPriceCents: 1000,
        requiresPreparation: true,
      },
    },
  ];

  return { lockers, doors, rentals: {}, payments: {}, events: [] };
}

function loadMockDb(): MockDatabaseState {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) {
      const initial = createInitialMockDatabase();
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw) as MockDatabaseState;
  } catch {
    return createInitialMockDatabase();
  }
}

function saveMockDb(state: MockDatabaseState): void {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
}

export function emitMockWsEvent<K extends WsEventName>(
  event: K,
  payload: WsEventPayloadMap[K],
): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const envelope: WsEnvelope<K> = {
    event,
    timestamp: new Date().toISOString(),
    correlationId: `mock-evt-${Math.random().toString(36).slice(2, 8)}`,
    payload,
  };
  const channel = new BroadcastChannel(MOCK_WS_CHANNEL_NAME);
  channel.postMessage(envelope);
  channel.close();
  window.dispatchEvent(new CustomEvent('conectalab:mock-ws', { detail: envelope }));
}

/**
 * Processa o fechamento físico de porta no modo Mock (chamado pelo Simulador /locker)
 */
export function handleMockDoorClosed(doorId: string): void {
  const db = loadMockDb();
  const door = db.doors.find((d) => d.id === doorId);
  if (!door) return;

  door.lockState = 'LOCKED';
  const rental = door.currentRentalId ? db.rentals[door.currentRentalId] : undefined;

  if (rental && rental.status === 'PAID_READY_FOR_PICKUP') {
    const now = new Date();
    const durationMs =
      rental.planType === 'HOURLY'
        ? rental.durationUnits * 3600_000
        : rental.durationUnits * 24 * 3600_000;
    rental.status = 'IN_USE';
    rental.doorLockState = 'LOCKED';
    rental.pickedUpAt = now.toISOString();
    rental.expectedReturnAt = new Date(now.getTime() + durationMs).toISOString();
    door.status = 'OCCUPIED_RENTED';
    door.expectedReturnAt = rental.expectedReturnAt;
  } else if (rental && rental.status === 'AWAITING_RETURN_CLOSE') {
    rental.status = 'COMPLETED';
    rental.doorLockState = 'LOCKED';
    rental.returnedAt = new Date().toISOString();
    // Regra RF17: Jaleco e Powerbank entram em IN_PREPARATION após devolução
    door.status = door.item?.requiresPreparation ? 'IN_PREPARATION' : 'AVAILABLE';
    door.currentRentalId = null;
    door.currentOccupantName = null;
    door.expectedReturnAt = null;
  }

  saveMockDb(db);

  emitMockWsEvent('CATALOG_STOCK_UPDATED', {
    lockerId: door.lockerId,
    door: {
      id: door.id,
      doorNumber: door.doorNumber,
      status: door.status,
      lockState: door.lockState,
      currentRentalId: door.currentRentalId,
      currentOccupantName: door.currentOccupantName,
      expectedReturnAt: door.expectedReturnAt,
    },
  });

  if (rental) {
    emitMockWsEvent('RENTAL_STATUS_UPDATED', {
      rentalId: rental.id,
      status: rental.status,
      doorId: door.id,
      doorNumber: door.doorNumber,
      doorStatus: door.status,
      lockState: door.lockState,
      paidAt: rental.paidAt,
      pickedUpAt: rental.pickedUpAt,
      expectedReturnAt: rental.expectedReturnAt,
      returnedAt: rental.returnedAt,
    });
  }
}

// ============================================================================
// HELPER HTTP REAL (PARA INTEGRAÇÃO COM DEV 2 E DEV 3)
// ============================================================================

async function httpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const rawUser = localStorage.getItem(SESSION_USER_KEY);
  const userId = rawUser ? (JSON.parse(rawUser) as { id?: string }).id : undefined;

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Erro HTTP ${response.status}`);
  }
  return data as T;
}

// ============================================================================
// CLIENTE API EXPORTADO PARA AS TELAS DO DEV 1
// ============================================================================

export const api = {
  /**
   * RF01: Autenticação Institucional Rápida
   */
  async quickLogin(payload: QuickLoginRequest): Promise<QuickLoginResponse> {
    if (!isUsingMockApi()) {
      const res = await httpRequest<QuickLoginResponse>('/api/auth/quick-login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      localStorage.setItem(SESSION_TOKEN_KEY, res.token);
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(res.user));
      return res;
    }

    const emailLower = payload.email.trim().toLowerCase();
    if (
      !emailLower.endsWith('@faculdade.edu.br') &&
      !emailLower.endsWith('@aluno.faculdade.edu.br')
    ) {
      throw new Error(
        'Use seu e-mail institucional (@faculdade.edu.br) para acessar os armários do campus.',
      );
    }

    const user = {
      id: `usr-${payload.ra.trim()}`,
      name: payload.name.trim(),
      ra: payload.ra.trim(),
      email: emailLower,
      role: 'STUDENT' as const,
    };
    const token = `mock-token-${user.id}`;
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));

    return { token, user, activeRentalId: null };
  },

  /**
   * RF02 / RF11: Listar Armários por Bloco
   */
  async listLockers(): Promise<ListLockersResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<ListLockersResponse>('/api/lockers');
    }
    const db = loadMockDb();
    return { lockers: db.lockers };
  },

  /**
   * RF02 / RF11: Obter Catálogo e Portas de um Armário
   */
  async getLockerCatalog(lockerId: string): Promise<LockerCatalogResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<LockerCatalogResponse>(`/api/lockers/${lockerId}/catalog`);
    }
    const db = loadMockDb();
    const locker = db.lockers.find((l) => l.id === lockerId) ?? db.lockers[0];
    const doors = db.doors
      .filter((d) => d.lockerId === locker.id)
      .sort((a, b) => a.doorNumber - b.doorNumber);
    return { locker, doors };
  },

  /**
   * RF03 / RF04: Criar Reserva Antecipada com Bloqueio Imediato (RN02)
   */
  async createRental(payload: CreateRentalRequest): Promise<CreateRentalResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<CreateRentalResponse>('/api/rentals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    const db = loadMockDb();
    const door = db.doors.find((d) => d.id === payload.doorId);
    if (!door || !door.item) {
      throw new Error('Porta não encontrada.');
    }
    if (door.status !== 'AVAILABLE') {
      throw new Error(
        'Ops! Este objeto acabou de ser reservado por outro colega. Escolha outra porta disponível.',
      );
    }

    const rawUser = localStorage.getItem(SESSION_USER_KEY);
    const user = rawUser
      ? (JSON.parse(rawUser) as { id: string; name: string; ra: string })
      : { id: 'usr-student-01', name: 'Lucas Andrade', ra: '20261045' };

    const unitPrice =
      payload.planType === 'HOURLY' ? door.item.hourlyPriceCents : door.item.dailyPriceCents;
    const totalAmountCents = unitPrice * payload.durationUnits;
    const rentalId = `rnt-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();

    const rental: Rental = {
      id: rentalId,
      userId: user.id,
      userName: user.name,
      userRa: user.ra,
      lockerId: door.lockerId,
      doorId: door.id,
      doorNumber: door.doorNumber,
      doorLockState: 'LOCKED',
      itemId: door.item.id,
      itemName: door.item.name,
      itemSku: door.item.sku,
      planType: payload.planType,
      durationUnits: payload.durationUnits,
      totalAmountCents,
      status: 'AWAITING_PAYMENT',
      reservationExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      createdAt: now.toISOString(),
    };

    const payment: Payment = {
      id: `pay-${Math.random().toString(36).slice(2, 9)}`,
      rentalId,
      amountCents: totalAmountCents,
      method: 'PIX_MOCK',
      status: 'PENDING',
      pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136conectalab-pix-${rentalId}5204000053039865802BR5910CONECTALAB6009SAOPAULO6304ABCD`,
      createdAt: now.toISOString(),
    };

    door.status = 'RESERVED';
    door.currentRentalId = rentalId;
    door.currentOccupantName = user.name;
    door.currentOccupantRa = user.ra;

    db.rentals[rentalId] = rental;
    db.payments[rentalId] = payment;
    saveMockDb(db);

    emitMockWsEvent('CATALOG_STOCK_UPDATED', {
      lockerId: door.lockerId,
      door: {
        id: door.id,
        doorNumber: door.doorNumber,
        status: door.status,
        lockState: door.lockState,
        currentRentalId: rentalId,
        currentOccupantName: user.name,
      },
    });

    return { rental, payment };
  },

  /**
   * RF07: Consultar Locação por ID
   */
  async getRentalDetails(rentalId: string): Promise<GetRentalDetailsResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<GetRentalDetailsResponse>(`/api/rentals/${rentalId}`);
    }
    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');
    return { rental, payment: db.payments[rentalId] ?? null };
  },

  /**
   * RF05: Simular Confirmação do Pagamento PIX (Webhook Mock)
   */
  async confirmPixPaymentMock(rentalId: string): Promise<PixMockWebhookResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<PixMockWebhookResponse>('/api/payments/pix-mock-webhook', {
        method: 'POST',
        body: JSON.stringify({ rentalId }),
      });
    }

    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');

    const door = db.doors.find((d) => d.id === rental.doorId);
    const payment = db.payments[rentalId];
    const paidAt = new Date().toISOString();

    rental.status = 'PAID_READY_FOR_PICKUP';
    rental.paidAt = paidAt;
    if (payment) {
      payment.status = 'PAID';
      payment.paidAt = paidAt;
    }
    if (door) {
      door.status = 'AWAITING_PICKUP';
    }
    saveMockDb(db);

    if (door) {
      emitMockWsEvent('CATALOG_STOCK_UPDATED', {
        lockerId: door.lockerId,
        door: {
          id: door.id,
          doorNumber: door.doorNumber,
          status: door.status,
          lockState: door.lockState,
          currentRentalId: rental.id,
          currentOccupantName: rental.userName,
        },
      });
    }

    emitMockWsEvent('RENTAL_STATUS_UPDATED', {
      rentalId: rental.id,
      status: rental.status,
      doorId: rental.doorId,
      doorNumber: rental.doorNumber,
      doorStatus: 'AWAITING_PICKUP',
      lockState: 'LOCKED',
      paidAt,
    });

    return {
      success: true,
      rentalId,
      rentalStatus: 'PAID_READY_FOR_PICKUP',
      doorStatus: 'AWAITING_PICKUP',
      paidAt,
      canUnlock: true,
    };
  },

  /**
   * RF06: Destravar Armário para Retirada
   */
  async unlockRentalDoor(rentalId: string): Promise<UnlockRentalResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<UnlockRentalResponse>(`/api/rentals/${rentalId}/unlock`, {
        method: 'POST',
      });
    }

    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');
    if (rental.status === 'AWAITING_PAYMENT') {
      throw new Error('O destravamento só é permitido após a confirmação do pagamento PIX.');
    }

    const door = db.doors.find((d) => d.id === rental.doorId);
    if (!door) throw new Error('Porta não encontrada.');

    const now = new Date();
    door.lockState = 'UNLOCKED';
    rental.doorLockState = 'UNLOCKED';
    if (!rental.firstUnlockedAt) {
      rental.firstUnlockedAt = now.toISOString();
    }
    const inspectionWindowEndsAt = new Date(now.getTime() + 120_000).toISOString();
    saveMockDb(db);

    emitMockWsEvent('DOOR_UNLOCK_COMMAND', {
      lockerId: door.lockerId,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'UNLOCKED',
      actionContext: 'PICKUP',
      rentalId: rental.id,
      itemName: rental.itemName,
      triggeredBy: {
        userId: rental.userId,
        userName: rental.userName ?? 'Aluno',
        role: 'STUDENT',
      },
      playSoundEffect: true,
    });

    return {
      success: true,
      rentalId: rental.id,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'UNLOCKED',
      wsDispatched: true,
      inspectionWindowEndsAt,
      message: `Porta #${door.doorNumber} destravada! Retire seu objeto e feche a porta.`,
    };
  },

  /**
   * RF08: Destravar Porta para Devolução do Objeto
   */
  async returnUnlockRental(rentalId: string): Promise<ReturnUnlockRentalResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<ReturnUnlockRentalResponse>(`/api/rentals/${rentalId}/return-unlock`, {
        method: 'POST',
      });
    }

    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');
    const door = db.doors.find((d) => d.id === rental.doorId);
    if (!door) throw new Error('Porta não encontrada.');

    rental.status = 'AWAITING_RETURN_CLOSE';
    rental.doorLockState = 'UNLOCKED';
    door.lockState = 'UNLOCKED';
    saveMockDb(db);

    emitMockWsEvent('DOOR_UNLOCK_COMMAND', {
      lockerId: door.lockerId,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'UNLOCKED',
      actionContext: 'RETURN',
      rentalId: rental.id,
      itemName: rental.itemName,
      triggeredBy: {
        userId: rental.userId,
        userName: rental.userName ?? 'Aluno',
        role: 'STUDENT',
      },
      playSoundEffect: true,
    });

    return {
      success: true,
      rentalId: rental.id,
      rentalStatus: 'AWAITING_RETURN_CLOSE',
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'UNLOCKED',
      message: `Porta #${door.doorNumber} aberta para devolução! Guarde o objeto e feche a porta.`,
    };
  },

  /**
   * RF09 (Extra): Prorrogar Horário da Locação
   */
  async extendRental(rentalId: string, payload: ExtendRentalRequest): Promise<ExtendRentalResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<ExtendRentalResponse>(`/api/rentals/${rentalId}/extend`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');
    const door = db.doors.find((d) => d.id === rental.doorId);
    const addedMs =
      payload.planType === 'HOURLY'
        ? payload.additionalUnits * 3600_000
        : payload.additionalUnits * 24 * 3600_000;
    const baseTime = rental.expectedReturnAt ? new Date(rental.expectedReturnAt) : new Date();
    rental.expectedReturnAt = new Date(baseTime.getTime() + addedMs).toISOString();
    const unitCents = door?.item
      ? payload.planType === 'HOURLY'
        ? door.item.hourlyPriceCents
        : door.item.dailyPriceCents
      : 300;
    const addedAmountCents = unitCents * payload.additionalUnits;
    rental.totalAmountCents += addedAmountCents;
    saveMockDb(db);

    return {
      success: true,
      rental,
      addedAmountCents,
      message: 'Prazo da locação prorrogado com sucesso!',
    };
  },

  /**
   * RF10 (Extra): Reportar Defeito na Vistoria Expressa (2 minutos)
   */
  async reportRentalIssue(
    rentalId: string,
    payload: ReportIssueRequest,
  ): Promise<ReportIssueResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<ReportIssueResponse>(`/api/rentals/${rentalId}/report-issue`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    const db = loadMockDb();
    const rental = db.rentals[rentalId];
    if (!rental) throw new Error('Locação não encontrada.');
    const door = db.doors.find((d) => d.id === rental.doorId);

    rental.status = 'CANCELLED';
    rental.cancelReason = 'ISSUE_REPORTED';
    rental.issueNotes = payload.issueNotes;
    if (door) {
      door.status = 'MAINTENANCE';
      door.lockState = 'LOCKED';
      door.currentRentalId = null;
    }
    saveMockDb(db);

    return {
      success: true,
      rentalId,
      rentalStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      doorStatus: 'MAINTENANCE',
      message: 'Problema reportado! Cobrança estornada e porta bloqueada para manutenção.',
    };
  },

  /**
   * RF14 / RF15 / RF17: Painel Administrativo
   */
  async getAdminDashboard(): Promise<AdminDashboardSummaryResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<AdminDashboardSummaryResponse>('/api/admin/dashboard');
    }
    const db = loadMockDb();
    return {
      lockers: db.lockers,
      doors: db.doors,
      recentEvents: db.events,
    };
  },

  async adminMasterUnlock(doorId: string): Promise<AdminMasterUnlockResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<AdminMasterUnlockResponse>(`/api/admin/doors/${doorId}/master-unlock`, {
        method: 'POST',
      });
    }
    const db = loadMockDb();
    const door = db.doors.find((d) => d.id === doorId);
    if (!door) throw new Error('Porta não encontrada.');
    door.lockState = 'UNLOCKED';
    saveMockDb(db);

    emitMockWsEvent('DOOR_UNLOCK_COMMAND', {
      lockerId: door.lockerId,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'UNLOCKED',
      actionContext: 'MASTER_OVERRIDE',
      itemName: door.item?.name ?? 'Item',
      triggeredBy: {
        userId: 'usr-admin-01',
        userName: 'Mariana Costa (Admin)',
        role: 'ADMIN',
      },
      playSoundEffect: true,
    });

    return {
      success: true,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockerId: door.lockerId,
      lockState: 'UNLOCKED',
      message: `Porta #${door.doorNumber} destravada via Master Override!`,
    };
  },

  async adminUpdateDoorStatus(
    doorId: string,
    status: DoorStatus,
  ): Promise<AdminUpdateDoorStatusResponse> {
    if (!isUsingMockApi()) {
      return httpRequest<AdminUpdateDoorStatusResponse>(`/api/admin/doors/${doorId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    }
    const db = loadMockDb();
    const door = db.doors.find((d) => d.id === doorId);
    if (!door) throw new Error('Porta não encontrada.');
    door.status = status;
    if (status === 'AVAILABLE') {
      door.currentRentalId = null;
      door.currentOccupantName = null;
      door.expectedReturnAt = null;
    }
    saveMockDb(db);

    emitMockWsEvent('CATALOG_STOCK_UPDATED', {
      lockerId: door.lockerId,
      door: {
        id: door.id,
        doorNumber: door.doorNumber,
        status: door.status,
        lockState: door.lockState,
      },
    });

    return {
      success: true,
      door,
      message: `Status da Porta #${door.doorNumber} atualizado para ${status}.`,
    };
  },

  async adminResetDemo(): Promise<{ success: boolean; message: string }> {
    if (!isUsingMockApi()) {
      return httpRequest<{ success: boolean; message: string }>('/api/admin/demo/reset', {
        method: 'POST',
      });
    }
    const fresh = createInitialMockDatabase();
    saveMockDb(fresh);
    return {
      success: true,
      message: 'Estado Mock resetado para os seeds originais!',
    };
  },
};
