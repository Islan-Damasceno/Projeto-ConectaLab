import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { WsClientType, WsEnvelope, WsEventName } from '../../../shared/types.js';
import { registerWsConnection } from '../../ws/broker.js';

export interface WsSpyClient {
  messages: WsEnvelope[];
  getByEvent<K extends WsEventName>(event: K): WsEnvelope<K>[];
  clear(): void;
  close(): void;
}

/**
 * Conecta um cliente WebSocket simulado em memória ao `broker.ts` (sem abrir porta TCP
 * e sem modificar `broker.ts` do Dev 3) para inspecionar eventos emitidos pelas rotas e workers do Dev 2.
 */
export function createWsSpyClient(query: {
  clientType: WsClientType;
  lockerId?: string;
  userId?: string;
}): WsSpyClient {
  const emitter = new EventEmitter();
  const messages: WsEnvelope[] = [];

  const fakeSocket = Object.assign(emitter, {
    readyState: 1, // WebSocket.OPEN
    send(serialized: string) {
      messages.push(JSON.parse(serialized) as WsEnvelope);
    },
  }) as unknown as WebSocket;

  registerWsConnection(fakeSocket, query);

  return {
    messages,
    getByEvent<K extends WsEventName>(event: K): WsEnvelope<K>[] {
      return messages.filter((m): m is WsEnvelope<K> => m.event === event);
    },
    clear() {
      messages.length = 0;
    },
    close() {
      (fakeSocket as unknown as { readyState: number }).readyState = 3; // CLOSED
      emitter.emit('close');
    },
  };
}
