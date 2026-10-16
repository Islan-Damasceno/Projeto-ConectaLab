import React from 'react';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import type { DoorWithItem } from '../../../shared/types.js';

/**
 * Painel Administrativo e Gestão de Estoque (/admin — RF14, RF15, RF16, RF17)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-05)
 *
 * // TODO: [FE-05] (Dev 1 - Frontend):
 * - Exibir cards de métricas (Total, Disponíveis, Em Uso, Em Preparo, Manutenção).
 * - Implementar tabela completa com botões Master Unlock (RF15), Liberar Higienização/Recarga (RF17) e Reset Demo.
 */
export function AdminDashboardPage() {
  const [doors, setDoors] = React.useState<DoorWithItem[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);

  const loadDashboard = React.useCallback(async () => {
    const res = await api.getAdminDashboard();
    setDoors(res.doors);
  }, []);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useConectaWs({
    clientType: 'ADMIN',
    onEvent: () => {
      void loadDashboard();
    },
  });

  const handleMasterUnlock = async (doorId: string) => {
    const res = await api.adminMasterUnlock(doorId);
    setMessage(res.message);
    void loadDashboard();
  };

  const handleReleaseDoor = async (doorId: string) => {
    const res = await api.adminUpdateDoorStatus(doorId, 'AVAILABLE');
    setMessage(res.message);
    void loadDashboard();
  };

  const handleResetDemo = async () => {
    const res = await api.adminResetDemo();
    setMessage(res.message);
    void loadDashboard();
  };

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ConectaLab Admin — Gestão de Operações e Portas</h1>
          <p className="text-xs text-slate-400">
            TODO [FE-05]: Completar dashboard administrativo (RF14, RF15, RF16, RF17).
          </p>
        </div>
        <button
          onClick={handleResetDemo}
          className="px-4 py-2 rounded bg-rose-500/20 border border-rose-500 text-rose-200 text-sm font-bold"
        >
          🔄 Resetar Demo p/ Estado Inicial
        </button>
      </div>

      {message && (
        <div className="p-3 rounded bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-sm">
          {message}
        </div>
      )}

      <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="p-3">Porta</th>
              <th className="p-3">Armário</th>
              <th className="p-3">Objeto</th>
              <th className="p-3">Status Estoque</th>
              <th className="p-3">Trava</th>
              <th className="p-3">Ações do Operador</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {doors.map((door) => (
              <tr key={door.id}>
                <td className="p-3 font-bold">#{door.doorNumber}</td>
                <td className="p-3">{door.lockerId}</td>
                <td className="p-3">{door.item?.name}</td>
                <td className="p-3">{door.status}</td>
                <td className="p-3">{door.lockState}</td>
                <td className="p-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleMasterUnlock(door.id)}
                    className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-xs"
                  >
                    🔓 Master Unlock
                  </button>
                  {door.status !== 'AVAILABLE' && (
                    <button
                      onClick={() => handleReleaseDoor(door.id)}
                      className="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-bold text-xs"
                    >
                      ✅ Liberar Porta
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
