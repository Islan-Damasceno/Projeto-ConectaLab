import React from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import type { Rental } from '../../../shared/types.js';

/**
 * Tela 4 de 4: Comando de Retirada, Painel Ativo e Devolução (/app/rental/:rentalId — RF06, RF07, RF08, RF09, RF10)
 * Responsável Exclusivo: Dev 1 (Frontend — Cards FE-02 e FE-03)
 *
 * // TODO: [FE-02] (Dev 1 - Frontend):
 * - Implementar botão pulsante "🔓 DESTRAVAR ARMÁRIO (PORTA #XX)" (RF06).
 * - Exibir cronômetro regressivo quando `status === 'IN_USE'` (RF07).
 * - Implementar botão "📦 Devolver Objeto" (RF08).
 *
 * // TODO: [FE-03] (Dev 1 - Frontend):
 * - Implementar botão de Prorrogação de Horário (+1h / +1 dia) (RF09).
 * - Implementar botão de Reporte de Defeito na janela de 2 minutos (RF10).
 */
export function ActiveRentalPage() {
  const { rentalId } = useParams<{ rentalId: string }>();
  const [rental, setRental] = React.useState<Rental | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const loadDetails = React.useCallback(async () => {
    if (!rentalId) return;
    const res = await api.getRentalDetails(rentalId);
    setRental(res.rental);
  }, [rentalId]);

  React.useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useConectaWs({
    clientType: 'STUDENT',
    userId: rental?.userId,
    onEvent: (envelope) => {
      if (envelope.event === 'RENTAL_STATUS_UPDATED') {
        void loadDetails();
      }
    },
  });

  const handleUnlockPickup = async () => {
    if (!rentalId) return;
    const res = await api.unlockRentalDoor(rentalId);
    setFeedback(res.message);
    void loadDetails();
  };

  const handleReturnUnlock = async () => {
    if (!rentalId) return;
    const res = await api.returnUnlockRental(rentalId);
    setFeedback(res.message);
    void loadDetails();
  };

  return (
    <main className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Painel de Locação & Controle da Porta</h1>
      <p className="text-xs text-slate-400">
        TODO [FE-02 / FE-03]: Completar Cronômetro Regressivo, Devolução, Prorrogação e Vistoria 2m.
      </p>
      {feedback && (
        <div className="p-3 rounded bg-emerald-500/20 border border-emerald-500 text-emerald-200 text-sm">
          {feedback}
        </div>
      )}
      {rental && (
        <div className="p-4 rounded bg-slate-900 border border-slate-800 space-y-3">
          <div className="text-sm text-slate-400">Status: {rental.status}</div>
          <div className="text-lg font-bold">
            Porta #{rental.doorNumber} — {rental.itemName}
          </div>

          {rental.status === 'PAID_READY_FOR_PICKUP' && (
            <button
              onClick={handleUnlockPickup}
              className="w-full py-4 rounded-lg bg-emerald-500 text-slate-950 font-extrabold text-lg"
            >
              🔓 DESTRAVAR ARMÁRIO (PORTA #{rental.doorNumber})
            </button>
          )}

          {rental.status === 'IN_USE' && (
            <button
              onClick={handleReturnUnlock}
              className="w-full py-3 rounded-lg bg-sky-500 text-slate-950 font-bold"
            >
              📦 DEVOLVER OBJETO (ABRIR PORTA #{rental.doorNumber})
            </button>
          )}
        </div>
      )}
    </main>
  );
}
