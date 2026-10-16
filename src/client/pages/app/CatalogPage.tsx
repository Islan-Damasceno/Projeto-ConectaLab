import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import type { DoorWithItem, Locker } from '../../../shared/types.js';

/**
 * Tela 2 de 4: Catálogo por Bloco/Armário e Seleção de Período (/app/catalog — RF02, RF03, RF04)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-01)
 *
 * // TODO: [FE-01] (Dev 1 - Frontend):
 * - Implementar filtro por Armário/Bloco, seletor Por Hora vs Diária e cálculo dinâmico de valor (RF03).
 * - Atualizar disponibilidade em tempo real ao receber evento WS `CATALOG_STOCK_UPDATED`.
 */
export function CatalogPage() {
  const navigate = useNavigate();
  const [lockers, setLockers] = React.useState<Locker[]>([]);
  const [selectedLockerId, setSelectedLockerId] = React.useState('locker-bloco-b');
  const [doors, setDoors] = React.useState<DoorWithItem[]>([]);

  const loadCatalog = React.useCallback(async (lockerId: string) => {
    const [{ lockers: list }, catalog] = await Promise.all([
      api.listLockers(),
      api.getLockerCatalog(lockerId),
    ]);
    setLockers(list);
    setDoors(catalog.doors);
  }, []);

  React.useEffect(() => {
    void loadCatalog(selectedLockerId);
  }, [selectedLockerId, loadCatalog]);

  useConectaWs({
    clientType: 'STUDENT',
    onEvent: (envelope) => {
      if (envelope.event === 'CATALOG_STOCK_UPDATED') {
        void loadCatalog(selectedLockerId);
      }
    },
  });

  const handleQuickReserve = async (doorId: string) => {
    const res = await api.createRental({
      doorId,
      planType: 'HOURLY',
      durationUnits: 2,
    });
    navigate(`/app/checkout/${res.rental.id}`);
  };

  return (
    <main className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Catálogo por Ponto de Retirada</h1>
      <p className="text-xs text-slate-400">
        TODO [FE-01]: Adicionar seletor Por Hora / Diária e badges completos (RF02, RF03, RF04).
      </p>
      <select
        value={selectedLockerId}
        onChange={(e) => setSelectedLockerId(e.target.value)}
        className="w-full p-2.5 rounded bg-slate-900 border border-slate-700"
      >
        {lockers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <div className="space-y-3">
        {doors.map((door) => (
          <div
            key={door.id}
            className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex flex-col gap-2"
          >
            <div className="flex justify-between items-center">
              <span className="font-bold text-emerald-400">PORTA #{door.doorNumber}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800">{door.status}</span>
            </div>
            <div className="font-medium">{door.item?.name}</div>
            {door.status === 'AVAILABLE' && (
              <button
                onClick={() => handleQuickReserve(door.id)}
                className="mt-2 py-2 px-4 rounded bg-emerald-500 text-slate-950 font-bold text-sm"
              >
                Reservar Porta #{door.doorNumber}
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
