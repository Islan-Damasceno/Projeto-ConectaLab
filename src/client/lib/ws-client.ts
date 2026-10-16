import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  WsClientType,
  WsEnvelope,
  WsEventName,
  WsEventPayloadMap,
} from '../../shared/types.js';
import {
  isUsingMockApi,
  MOCK_WS_CHANNEL_NAME,
  handleMockDoorClosed,
} from './api.js';

export interface UseConectaWsOptions {
  clientType: WsClientType;
  lockerId?: string;
  userId?: string;
  onEvent?: (envelope: WsEnvelope) => void;
}

/**
 * Hook React para conexão WebSocket em Tempo Real (< 500ms)
 * Compatível com:
 * 1. Modo Mock (`USE_MOCK = true`): escuta `BroadcastChannel` entre abas locais do navegador.
 * 2. Servidor Real / Cloudflare Tunnel (`USE_MOCK = false`): conecta em `ws(s)://<origin>/ws`.
 */
export function useConectaWs({
  clientType,
  lockerId,
  userId,
  onEvent,
}: UseConectaWsOptions) {
  const [isConnected, setIsConnected] = useState<boolean>(isUsingMockApi());
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // 1. Escuta o BroadcastChannel local para funcionamento instantâneo em modo Mock
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(MOCK_WS_CHANNEL_NAME);
      channel.onmessage = (ev) => {
        if (ev.data && onEventRef.current) {
          onEventRef.current(ev.data as WsEnvelope);
        }
      };
    }

    const handleCustomMockEvent = (ev: Event) => {
      const customEv = ev as CustomEvent<WsEnvelope>;
      if (customEv.detail && onEventRef.current) {
        onEventRef.current(customEv.detail);
      }
    };
    window.addEventListener('conectalab:mock-ws', handleCustomMockEvent);

    // 2. Se estiver usando o Backend Real, abre conexão WebSocket na mesma origem (porta 3000 / Cloudflare Tunnel)
    if (!isUsingMockApi()) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ clientType });
      if (lockerId) params.set('lockerId', lockerId);
      if (userId) params.set('userId', userId);

      const wsUrl = `${protocol}//${window.location.host}/ws?${params.toString()}`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => setIsConnected(true);
      socket.onclose = () => setIsConnected(false);
      socket.onmessage = (msg) => {
        try {
          const envelope = JSON.parse(msg.data) as WsEnvelope;
          onEventRef.current?.(envelope);
        } catch (err) {
          console.error('[WS Client] Erro ao ler pacote JSON:', err);
        }
      };
    } else {
      setIsConnected(true);
    }

    return () => {
      channel?.close();
      window.removeEventListener('conectalab:mock-ws', handleCustomMockEvent);
      wsRef.current?.close();
    };
  }, [clientType, lockerId, userId]);

  /**
   * Envia um evento do cliente (ex: Simulador `/locker` enviando DOOR_OPENED_ACK ou DOOR_CLOSED_EVENT)
   */
  const sendWsEvent = useCallback(
    <K extends WsEventName>(event: K, payload: WsEventPayloadMap[K]) => {
      const envelope: WsEnvelope<K> = {
        event,
        timestamp: new Date().toISOString(),
        correlationId: `cli-${Math.random().toString(36).slice(2, 8)}`,
        payload,
      };

      if (isUsingMockApi()) {
        if (event === 'DOOR_CLOSED_EVENT') {
          const closedPayload = payload as WsEventPayloadMap['DOOR_CLOSED_EVENT'];
          handleMockDoorClosed(closedPayload.doorId);
        }
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(envelope));
      }
    },
    [],
  );

  return { isConnected, sendWsEvent };
}
