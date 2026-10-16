import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Rental, Payment } from '../../../shared/types.js';

/**
 * Tela 3 de 4: Checkout PIX Simulado (/app/checkout/:rentalId — RF05)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-02)
 *
 * // TODO: [FE-02] (Dev 1 - Frontend):
 * - Renderizar QR Code PIX visual, código Copia e Cola, cronômetro TTL da reserva e
 *   botão de destaque "⚡ Simular Confirmação do Banco (PIX Pago)".
 */
export function CheckoutPixPage() {
  const { rentalId } = useParams<{ rentalId: string }>();
  const navigate = useNavigate();
  const [rental, setRental] = React.useState<Rental | null>(null);
  const [payment, setPayment] = React.useState<Payment | null>(null);

  React.useEffect(() => {
    if (!rentalId) return;
    void api.getRentalDetails(rentalId).then((res) => {
      setRental(res.rental);
      setPayment(res.payment);
    });
  }, [rentalId]);

  const handleConfirmPixMock = async () => {
    if (!rentalId) return;
    await api.confirmPixPaymentMock(rentalId);
    navigate(`/app/rental/${rentalId}`);
  };

  return (
    <main className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Checkout PIX Instantâneo (Mock)</h1>
      <p className="text-xs text-slate-400">
        TODO [FE-02]: Implementar QR Code SVG, Copia e Cola e Cronômetro TTL (RF05).
      </p>
      {rental && (
        <div className="p-4 rounded bg-slate-900 border border-slate-800 space-y-2">
          <div>
            Porta #{rental.doorNumber} — <strong>{rental.itemName}</strong>
          </div>
          <div>Valor Total: R$ {(rental.totalAmountCents / 100).toFixed(2)}</div>
          <div className="text-xs text-slate-400 break-all">
            PIX Copia e Cola: {payment?.pixCopyPaste}
          </div>
          <button
            onClick={handleConfirmPixMock}
            className="w-full mt-4 py-3 rounded bg-emerald-500 text-slate-950 font-bold"
          >
            ⚡ Simular Confirmação do Banco (PIX Pago)
          </button>
        </div>
      )}
    </main>
  );
}
