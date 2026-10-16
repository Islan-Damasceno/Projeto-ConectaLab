import type { WebSocket } from 'ws';
import crypto from 'node:crypto';
import type {
  WsClientType,
  WsEnvelope,
  WsEventName,
  WsEventPayloadMap,
  CatalogStockUpdatedPayload,
  RentalStatusUpdatedPayload,
  DoorUnlockCommandPayload,
} from '../../shared/types.js';

/**
 * Representa um cliente conectado ao Broker WebSocket
 */
export interface ConnectedWsClient {
  id: string;
  socket: WebSocket;
  clientType: WsClientType;
  lockerId?: string;
  userId?: string;
  connectedAt: string;
}

export interface ClientTargetFilter {
  clientType?: WsClientType;
  lockerId?: string;
  userId?: string;
}

const clients = new Map<string, ConnectedWsClient>();

/**
 * Cria o envelope JSON padronizado do protocolo Real-Time ConectaLab (Seção 5 do ADT.md)
 */
export function createWsEnvelope<K extends WsEventName>(
  event: K,
  payload: WsEventPayloadMap[K],
  correlationId?: string,
): WsEnvelope<K> {
  return {
    event,
    timestamp: new Date().toISOString(),
    correlationId: correlationId ?? `evt-${crypto.randomUUID().slice(0, 8)}`,
    payload,
  };
}

/**
 * Envia um evento tipado para TODOS os clientes conectados (Broadcast).
 * Seguro para ser chamado pelo Dev 2 mesmo se nenhum cliente WS estiver conectado.
 */
export function broadcastEvent<K extends WsEventName>(
  event: K,
  payload: WsEventPayloadMap[K],
  correlationId?: string,
): number {
  const envelope = createWsEnvelope(event, payload, correlationId);
  const serialized = JSON.stringify(envelope);
  let sentCount = 0;

  for (const client of clients.values()) {
    if (client.socket.readyState === 1 /* OPEN */) {
      client.socket.send(serialized);
      sentCount++;
    }
  }

  console.log(`[WS Broadcast] Evento=${event} | Destinatários=${sentCount}`);
  return sentCount;
}

/**
 * Envia um evento tipado apenas para os clientes que correspondem ao filtro (LOCKER, STUDENT ou ADMIN).
 * Seguro (Null-Safe) para uso imediato pelo Dev 2 e Dev 3.
 */
export function sendToClient<K extends WsEventName>(
  target: ClientTargetFilter,
  event: K,
  payload: WsEventPayloadMap[K],
  correlationId?: string,
): number {
  const envelope = createWsEnvelope(event, payload, correlationId);
  const serialized = JSON.stringify(envelope);
  let sentCount = 0;

  for (const client of clients.values()) {
    if (client.socket.readyState !== 1 /* OPEN */) continue;

    const matchesType = !target.clientType || client.clientType === target.clientType;
    const matchesLocker = !target.lockerId || client.lockerId === target.lockerId;
    const matchesUser = !target.userId || client.userId === target.userId;

    if (matchesType && matchesLocker && matchesUser) {
      client.socket.send(serialized);
      sentCount++;
    }
  }

  console.log(
    `[WS Targeted] Evento=${event} | Filtro=${JSON.stringify(target)} | Entregues=${sentCount}`,
  );
  return sentCount;
}

/**
 * Helper de alto nível para o Dev 2 (Backend A):
 * Notifica todas as telas (/app, /locker, /admin) que o status de uma porta mudou.
 */
export function broadcastCatalogStockUpdated(payload: CatalogStockUpdatedPayload): void {
  broadcastEvent('CATALOG_STOCK_UPDATED', payload);
}

/**
 * Helper de alto nível para o Dev 2 (Backend A) e Dev 3 (Backend B):
 * Notifica o celular do aluno e o painel Admin sobre mudança no status da locação.
 */
export function sendRentalStatusUpdated(
  userId: string,
  payload: RentalStatusUpdatedPayload,
): void {
  sendToClient({ clientType: 'STUDENT', userId }, 'RENTAL_STATUS_UPDATED', payload);
  sendToClient({ clientType: 'ADMIN' }, 'RENTAL_STATUS_UPDATED', payload);
}

/**
 * Helper de alto nível para o Dev 3 (Backend B):
 * Dispara comando de destravamento em < 500ms para o Simulador do Armário no Projetor.
 */
export function sendDoorUnlockCommand(payload: DoorUnlockCommandPayload): number {
  const deliveredToLocker = sendToClient(
    { clientType: 'LOCKER', lockerId: payload.lockerId },
    'DOOR_UNLOCK_COMMAND',
    payload,
  );
  // Também envia para qualquer tela /locker aberta sem filtro de lockerId específico e para o Admin
  if (deliveredToLocker === 0) {
    return sendToClient({ clientType: 'LOCKER' }, 'DOOR_UNLOCK_COMMAND', payload);
  }
  return deliveredToLocker;
}

/**
 * Registra uma nova conexão WebSocket recebida em GET /ws
 *
 * // TODO: [BE2-02] (Dev 3 - Backend B):
 * - Processar mensagens recebidas do Simulador:
 *   1. `DOOR_OPENED_ACK` (RF12): Registrar telemetria na tabela `door_events`.
 *   2. `DOOR_CLOSED_EVENT` (RF13, RF07, RF08, RF17):
 *      - Atualizar `doors.lock_state = 'LOCKED'` no SQLite.
 *      - Se a locação estava `PAID_READY_FOR_PICKUP`, mudar para `IN_USE`, gravar `picked_up_at` e `expected_return_at`, e mudar porta para `OCCUPIED_RENTED`.
 *      - Se a locação estava `AWAITING_RETURN_CLOSE`, mudar para `COMPLETED`, gravar `returned_at`, e mudar porta para `IN_PREPARATION` (se `requires_preparation = 1` - RF17) ou `AVAILABLE`.
 *      - Disparar `sendRentalStatusUpdated()` e `broadcastCatalogStockUpdated()`.
 */
export function registerWsConnection(
  socket: WebSocket,
  query: { clientType?: string; lockerId?: string; userId?: string },
): void {
  const clientId = crypto.randomUUID();
  const clientType = (query.clientType as WsClientType) || 'STUDENT';

  const client: ConnectedWsClient = {
    id: clientId,
    socket,
    clientType,
    lockerId: query.lockerId,
    userId: query.userId,
    connectedAt: new Date().toISOString(),
  };

  clients.set(clientId, client);
  console.log(
    `[WS Connect] Cliente=${clientId} | Tipo=${clientType} | Locker=${query.lockerId ?? '-'} | User=${query.userId ?? '-'}`,
  );

  if (clientType === 'LOCKER') {
    const handshake = createWsEnvelope('LOCKER_CONNECTED', {
      lockerId: query.lockerId ?? 'locker-bloco-b',
      lockerCode: query.lockerId === 'locker-bloco-a' ? 'BLOCO-A-01' : 'BLOCO-B-01',
      status: 'ONLINE',
      doorsCount: 4,
    });
    socket.send(JSON.stringify(handshake));
  }

  socket.on('message', (rawBuffer) => {
    try {
      const message = JSON.parse(rawBuffer.toString()) as WsEnvelope;
      console.log(`[WS Incoming] Evento=${message.event}`, message.payload);
      // TODO: [BE2-02] Dev 3 implementará o switch(message.event) para DOOR_OPENED_ACK e DOOR_CLOSED_EVENT aqui.
    } catch (err) {
      console.error('[WS Error] Falha ao processar mensagem JSON:', err);
    }
  });

  socket.on('close', () => {
    clients.delete(clientId);
    console.log(`[WS Disconnect] Cliente=${clientId} (${clientType}) desconectado.`);
  });
}
