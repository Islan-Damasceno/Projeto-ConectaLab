/**
 * ConectaLab — Shared Domain Types, REST Contracts & WebSocket Protocol
 *
 * ATENÇÃO (COMMIT ZERO):
 * Este arquivo é o contrato oficial entre Dev 1 (Frontend), Dev 2 (Backend A) e Dev 3 (Backend B).
 * Alinhado 100% com docs/SPEC.md e docs/ADT.md.
 */

// ============================================================================
// 1. ENUMS E ESTADOS DAS MÁQUINAS DE ESTADO
// ============================================================================

export type UserRole = 'STUDENT' | 'ADMIN';

export type ItemCategory = 'EXATAS' | 'SAUDE' | 'ENERGIA';

/**
 * Ciclo de vida do Item/Porta (RN01 - Vínculo 1:1)
 */
export type DoorStatus =
  | 'AVAILABLE'       // Disponivel
  | 'RESERVED'        // Reservado (aguardando pagamento PIX)
  | 'AWAITING_PICKUP' // AguardandoRetirada (PIX pago, pronto p/ destravar)
  | 'OCCUPIED_RENTED' // Alugado (Objeto com o aluno; porta aguardando devolução - RN04)
  | 'IN_PREPARATION'  // EmPreparacao (Higienização de jaleco / Recarga de powerbank - RF17)
  | 'MAINTENANCE';    // Manutencao (Indisponível por avaria reportada ou bloqueio admin - RF10/RF15)

/**
 * Estado físico da fechadura solenoide no Simulador Digital Twin
 */
export type LockState = 'LOCKED' | 'UNLOCKED';

/**
 * Modalidade de locação (RF03)
 */
export type PlanType = 'HOURLY' | 'DAILY';

/**
 * Ciclo de vida da Locação/Transação
 */
export type RentalStatus =
  | 'CREATED'                // Criada
  | 'AWAITING_PAYMENT'       // AguardandoPagamento
  | 'PAID_READY_FOR_PICKUP'  // Paga_LiberadaRetirada
  | 'IN_USE'                 // EmUso
  | 'AWAITING_RETURN_CLOSE'  // AguardandoFechamentoDevolucao
  | 'COMPLETED'              // Concluida
  | 'CANCELLED';             // Cancelada

export type CancelReason =
  | 'EXPIRED_TTL'
  | 'ISSUE_REPORTED'
  | 'USER_ABORT'
  | 'ADMIN_FORCE';

export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'EXPIRED';

export type PaymentMethod = 'PIX_MOCK';

export type DoorEventType =
  | 'UNLOCK_PICKUP'
  | 'UNLOCK_RETURN'
  | 'MASTER_UNLOCK'
  | 'DOOR_OPENED_ACK'
  | 'DOOR_CLOSED_PICKUP_COMPLETE'
  | 'DOOR_CLOSED_RETURN_COMPLETE'
  | 'STATUS_CHANGE';

export type UnlockActionContext = 'PICKUP' | 'RETURN' | 'MASTER_OVERRIDE';

// ============================================================================
// 2. ENTIDADES DE DOMÍNIO
// ============================================================================

export interface User {
  id: string;
  name: string;
  ra: string;
  email: string;
  role: UserRole;
  createdAt?: string;
}

export interface Locker {
  id: string;
  code: string;
  name: string;
  buildingLocation: string;
  isOnline: boolean;
  totalDoorsCount?: number;
  availableDoorsCount?: number;
}

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  category: ItemCategory;
  description: string;
  hourlyPriceCents: number;
  dailyPriceCents: number;
  requiresPreparation: boolean;
  imageUrl?: string | null;
}

export interface DoorWithItem {
  id: string;
  lockerId: string;
  doorNumber: number;
  status: DoorStatus;
  lockState: LockState;
  currentRentalId?: string | null;
  currentOccupantName?: string | null;
  currentOccupantRa?: string | null;
  expectedReturnAt?: string | null;
  updatedAt?: string;
  item: CatalogItem | null;
}

export interface Rental {
  id: string;
  userId: string;
  userName?: string;
  userRa?: string;
  lockerId: string;
  lockerName?: string;
  buildingLocation?: string;
  doorId: string;
  doorNumber: number;
  doorLockState?: LockState;
  itemId: string;
  itemName: string;
  itemSku?: string;
  planType: PlanType;
  durationUnits: number;
  totalAmountCents: number;
  status: RentalStatus;
  cancelReason?: CancelReason | null;
  issueNotes?: string | null;
  reservationExpiresAt: string;
  paidAt?: string | null;
  firstUnlockedAt?: string | null;
  pickedUpAt?: string | null;
  expectedReturnAt?: string | null;
  returnedAt?: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  rentalId: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  pixCopyPaste: string;
  pixQrSvg?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface DoorEventLog {
  id: number;
  doorId: string;
  doorNumber?: number;
  lockerCode?: string;
  rentalId?: string | null;
  userId?: string | null;
  userName?: string | null;
  eventType: DoorEventType;
  detailsJson?: string | null;
  createdAt: string;
}

// ============================================================================
// 3. CONTRATOS DA API REST (REQUESTS & RESPONSES)
// ============================================================================

export interface ApiErrorResponse {
  error: string;
  message: string;
}

// --- RF01: POST /api/auth/quick-login ---
export interface QuickLoginRequest {
  name: string;
  ra: string;
  email: string;
}

export interface QuickLoginResponse {
  token: string;
  user: User;
  activeRentalId: string | null;
}

// --- RF02, RF11: GET /api/lockers & GET /api/lockers/:lockerId/catalog ---
export interface ListLockersResponse {
  lockers: Locker[];
}

export interface LockerCatalogResponse {
  locker: Locker;
  doors: DoorWithItem[];
}

// --- RF03, RF04: POST /api/rentals ---
export interface CreateRentalRequest {
  doorId: string;
  planType: PlanType;
  durationUnits: number;
}

export interface CreateRentalResponse {
  rental: Rental;
  payment: Payment;
}

// --- RF07: GET /api/rentals/:rentalId ---
export interface GetRentalDetailsResponse {
  rental: Rental;
  payment: Payment | null;
}

// --- RF05: POST /api/payments/pix-mock-webhook ---
export interface PixMockWebhookRequest {
  rentalId: string;
}

export interface PixMockWebhookResponse {
  success: boolean;
  rentalId: string;
  rentalStatus: RentalStatus;
  doorStatus: DoorStatus;
  paidAt: string;
  canUnlock: boolean;
}

// --- RF06: POST /api/rentals/:rentalId/unlock ---
export interface UnlockRentalResponse {
  success: boolean;
  rentalId: string;
  doorId: string;
  doorNumber: number;
  lockState: LockState;
  wsDispatched: boolean;
  inspectionWindowEndsAt: string;
  message: string;
}

// --- RF08: POST /api/rentals/:rentalId/return-unlock ---
export interface ReturnUnlockRentalResponse {
  success: boolean;
  rentalId: string;
  rentalStatus: RentalStatus;
  doorId: string;
  doorNumber: number;
  lockState: LockState;
  message: string;
}

// --- RF09 (Extra): POST /api/rentals/:rentalId/extend ---
export interface ExtendRentalRequest {
  planType: PlanType;
  additionalUnits: number;
}

export interface ExtendRentalResponse {
  success: boolean;
  rental: Rental;
  addedAmountCents: number;
  message: string;
}

// --- RF10 (Extra): POST /api/rentals/:rentalId/report-issue ---
export interface ReportIssueRequest {
  issueNotes: string;
}

export interface ReportIssueResponse {
  success: boolean;
  rentalId: string;
  rentalStatus: RentalStatus;
  paymentStatus: PaymentStatus;
  doorStatus: DoorStatus;
  message: string;
}

// --- RF15, RF17: Rotas Administrativas (/api/admin/*) ---
export interface AdminMasterUnlockResponse {
  success: boolean;
  doorId: string;
  doorNumber: number;
  lockerId: string;
  lockState: LockState;
  message: string;
}

export interface AdminUpdateDoorStatusRequest {
  status: DoorStatus;
}

export interface AdminUpdateDoorStatusResponse {
  success: boolean;
  door: DoorWithItem;
  message: string;
}

export interface AdminDashboardSummaryResponse {
  lockers: Locker[];
  doors: DoorWithItem[];
  recentEvents: DoorEventLog[];
}

// ============================================================================
// 4. PROTOCOLO DE EVENTOS WEBSOCKET (REAL-TIME CONTRACT)
// ============================================================================

export type WsClientType = 'LOCKER' | 'STUDENT' | 'ADMIN';

export type WsEventName =
  | 'LOCKER_CONNECTED'
  | 'DOOR_UNLOCK_COMMAND'
  | 'DOOR_OPENED_ACK'
  | 'DOOR_CLOSED_EVENT'
  | 'RENTAL_STATUS_UPDATED'
  | 'CATALOG_STOCK_UPDATED';

/**
 * 1. LOCKER_CONNECTED (Handshake inicial do Simulador - RF11)
 */
export interface LockerConnectedPayload {
  lockerId: string;
  lockerCode: string;
  status: 'ONLINE' | 'OFFLINE';
  doorsCount: number;
}

/**
 * 2. DOOR_UNLOCK_COMMAND (Server -> Locker Simulator em < 500ms - RF06, RF08, RF12, RF15)
 */
export interface DoorUnlockCommandPayload {
  lockerId: string;
  doorId: string;
  doorNumber: number;
  lockState: 'UNLOCKED';
  actionContext: UnlockActionContext;
  rentalId?: string | null;
  itemName: string;
  triggeredBy: {
    userId: string;
    userName: string;
    role: UserRole;
  };
  playSoundEffect: boolean;
}

/**
 * 3. DOOR_OPENED_ACK (Locker Simulator -> Server após renderizar verde + tocar som - RF12)
 */
export interface DoorOpenedAckPayload {
  lockerId: string;
  doorId: string;
  doorNumber: number;
  rentalId?: string | null;
  audioPlayed: boolean;
  renderLatencyMs: number;
}

/**
 * 4. DOOR_CLOSED_EVENT (Locker Simulator -> Server ao clicar em "Simular Fechamento da Porta" - RF13)
 */
export interface DoorClosedEventPayload {
  lockerId: string;
  doorId: string;
  doorNumber: number;
  lockState: 'LOCKED';
  rentalId?: string | null;
}

/**
 * 5. RENTAL_STATUS_UPDATED (Server -> Student Mobile App & Admin - RF05, RF07, RF08, RF13)
 */
export interface RentalStatusUpdatedPayload {
  rentalId: string;
  status: RentalStatus;
  doorId: string;
  doorNumber: number;
  doorStatus: DoorStatus;
  lockState: LockState;
  paidAt?: string | null;
  pickedUpAt?: string | null;
  expectedReturnAt?: string | null;
  returnedAt?: string | null;
  inspectionWindowEndsAt?: string | null;
}

/**
 * 6. CATALOG_STOCK_UPDATED (Server Broadcast -> Todos os Clientes - RF02, RF14, RF17)
 */
export interface CatalogStockUpdatedPayload {
  lockerId: string;
  door: {
    id: string;
    doorNumber: number;
    status: DoorStatus;
    lockState: LockState;
    currentRentalId?: string | null;
    currentOccupantName?: string | null;
    expectedReturnAt?: string | null;
  };
}

/**
 * Mapa de tipagem estrita entre o nome do evento e seu Payload
 */
export interface WsEventPayloadMap {
  LOCKER_CONNECTED: LockerConnectedPayload;
  DOOR_UNLOCK_COMMAND: DoorUnlockCommandPayload;
  DOOR_OPENED_ACK: DoorOpenedAckPayload;
  DOOR_CLOSED_EVENT: DoorClosedEventPayload;
  RENTAL_STATUS_UPDATED: RentalStatusUpdatedPayload;
  CATALOG_STOCK_UPDATED: CatalogStockUpdatedPayload;
}

/**
 * Envelope JSON Padronizado do WebSocket
 */
export interface WsEnvelope<K extends WsEventName = WsEventName> {
  event: K;
  timestamp: string;
  correlationId: string;
  payload: WsEventPayloadMap[K];
}
