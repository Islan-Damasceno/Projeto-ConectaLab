import React from 'react';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import {
  unlockBrowserAudio,
  playSolenoidUnlockSound,
  playDoorCloseSound,
} from '../../lib/solenoid-audio.js';
import type {
  DoorWithItem,
  DoorUnlockCommandPayload,
} from '../../../shared/types.js';

/**
 * Simulador do Armário Inteligente — Digital Twin no PC/Projetor (/locker — RF11, RF12, RF13)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-04)
 *
 * // TODO: [FE-04] (Dev 1 - Frontend):
 * - Polir visual Dark Mode de alto contraste para o Projetor da sala (Seção 5.2 do SPEC.md).
 * - Exibir animações de porta TRANCADA (vermelho) vs ABERTA (verde neon pulsante).
 * - Exibir console de telemetria WebSocket no rodapé com latência em ms.
 */
export function LockerSimulatorPage() {
  const [lockerId] = React.useState('locker-bloco-b');
  const [doors, setDoors] = React.useState<DoorWithItem[]>([]);
  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);

  const appendLog = React.useCallback((line: string) => {
    const time = new Date().toISOString().slice(11, 23);
    setLogs((prev) => [`[${time}] ${line}`, ...prev.slice(0, 19)]);
  }, []);

  const loadDoors = React.useCallback(async () => {
    const res = await api.getLockerCatalog(lockerId);
    setDoors(res.doors);
  }, [lockerId]);

  React.useEffect(() => {
    void loadDoors();
  }, [loadDoors]);

  const { isConnected, sendWsEvent } = useConectaWs({
    clientType: 'LOCKER',
    lockerId,
    onEvent: (envelope) => {
      if (envelope.event === 'DOOR_UNLOCK_COMMAND') {
        const payload = envelope.payload as DoorUnlockCommandPayload;
        playSolenoidUnlockSound();
        appendLog(
          `[WS_IN] DOOR_UNLOCK_COMMAND -> Porta #${payload.doorNumber} (${payload.actionContext})`,
        );
        setDoors((prev) =>
          prev.map((d) =>
            d.id === payload.doorId ? { ...d, lockState: 'UNLOCKED' } : d,
          ),
        );
        sendWsEvent('DOOR_OPENED_ACK', {
          lockerId: payload.lockerId,
          doorId: payload.doorId,
          doorNumber: payload.doorNumber,
          rentalId: payload.rentalId,
          audioPlayed: true,
          renderLatencyMs: 18,
        });
      } else if (envelope.event === 'CATALOG_STOCK_UPDATED') {
        void loadDoors();
      }
    },
  });

  const handleSimulatePhysicalClose = (door: DoorWithItem) => {
    playDoorCloseSound();
    appendLog(`[SENSOR] Porta #${door.doorNumber} fechada fisicamente -> DOOR_CLOSED_EVENT`);
    setDoors((prev) =>
      prev.map((d) => (d.id === door.id ? { ...d, lockState: 'LOCKED' } : d)),
    );
    sendWsEvent('DOOR_CLOSED_EVENT', {
      lockerId: door.lockerId,
      doorId: door.id,
      doorNumber: door.doorNumber,
      lockState: 'LOCKED',
      rentalId: door.currentRentalId,
    });
    setTimeout(() => void loadDoors(), 100);
  };

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold">
            CONECTALAB SMART LOCKER — DIGITAL TWIN (PROJETOR)
          </h1>
          <p className="text-xs text-slate-400">
            Status WebSocket: {isConnected ? '🟢 ONLINE (< 500ms)' : '🔴 OFFLINE'}
          </p>
        </div>
        <button
          onClick={() => setAudioEnabled(unlockBrowserAudio())}
          className={`px-4 py-2 rounded-lg font-bold text-sm ${
            audioEnabled
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500'
              : 'bg-amber-500 text-slate-950'
          }`}
        >
          {audioEnabled ? '🔊 Som de Solenoide Ativo (Testar)' : '🔇 Ativar Som do Armário'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {doors.map((door) => {
          const isUnlocked = door.lockState === 'UNLOCKED';
          return (
            <div
              key={door.id}
              className={`p-5 rounded-xl border-2 transition-all ${
                isUnlocked
                  ? 'bg-emerald-950/40 border-emerald-400 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 border-red-500/60'
              }`}
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-xl font-black">PORTA #{door.doorNumber}</span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                    isUnlocked
                      ? 'bg-emerald-400 text-slate-950 animate-pulse'
                      : 'bg-red-500/20 text-red-300 border border-red-500/40'
                  }`}
                >
                  {isUnlocked ? '🔓 ABERTO' : '🔒 TRANCADO'}
                </span>
              </div>
              <div className="font-semibold text-slate-200">{door.item?.name}</div>
              <div className="text-xs text-slate-400 mt-1">Status Estoque: {door.status}</div>

              {isUnlocked && (
                <button
                  onClick={() => handleSimulatePhysicalClose(door)}
                  className="mt-4 w-full py-3 rounded-lg bg-emerald-400 text-slate-950 font-extrabold hover:bg-emerald-300"
                >
                  🤚 Simular Fechamento Físico da Porta #{door.doorNumber}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1">
        <div className="text-slate-400 font-bold mb-2">
          LOG DE TELEMETRIA E EVENTOS EM TEMPO REAL (WEBSOCKET):
        </div>
        {logs.length === 0 ? (
          <div className="text-slate-500">Aguardando comandos do celular...</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="text-emerald-300">
              {l}
            </div>
          ))
        )}
      </section>
    </main>
  );
}
