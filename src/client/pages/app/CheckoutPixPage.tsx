import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Timer, Zap } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import { AppHeader } from '../../components/AppHeader.js';
import { ItemIcon } from '../../components/ItemIcon.js';
import { Button } from '../../components/ui.js';
import { useNow } from '../../hooks/useNow.js';
import {
  brl,
  clock,
  doorLabel,
  durationLabel,
  itemShortName,
  lockerShortFromId,
} from '../../lib/format.js';
import type { Payment, Rental } from '../../../shared/types.js';

/**
 * Tela 3 de 4: Checkout Pix Simulado (/app/checkout/:rentalId — RF05)
 * Cards FE-02.1 e FE-02.2 (Dev 1 - Frontend)
 *
 * - Resumo do pedido e cronômetro de 10 min até a reserva expirar.
 * - QR Code Pix e código "copia e cola" com botão de copiar.
 * - Botão de demonstração que simula o banco confirmando o pagamento.
 * - Assim que o pagamento é confirmado (botão ou evento RENTAL_STATUS_UPDATED),
 *   vai sozinho para a tela da locação.
 */
export function CheckoutPixPage() {
  const { rentalId } = useParams<{ rentalId: string }>();
  const navigate = useNavigate();
  const now = useNow();

  const [rental, setRental] = React.useState<Rental | null>(null);
  const [payment, setPayment] = React.useState<Payment | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [paying, setPaying] = React.useState(false);

  const goToRental = React.useCallback(() => {
    if (rentalId) navigate(`/app/rental/${rentalId}`, { replace: true });
  }, [navigate, rentalId]);

  React.useEffect(() => {
    if (!rentalId) return;
    api
      .getRentalDetails(rentalId)
      .then((res) => {
        // Já pago? Não tem o que fazer aqui: vai para a locação.
        if (res.rental.status !== 'AWAITING_PAYMENT') return goToRental();
        setRental(res.rental);
        setPayment(res.payment);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Reserva não encontrada.'));
  }, [rentalId, goToRental]);

  // O banco confirmou (em outra aba, ou o backend real avisou)
  useConectaWs({
    clientType: 'STUDENT',
    userId: rental?.userId,
    onEvent: (envelope) => {
      if (envelope.event !== 'RENTAL_STATUS_UPDATED') return;
      const payload = envelope.payload as { rentalId: string; status: string };
      if (payload.rentalId !== rentalId) return;
      if (payload.status === 'PAID_READY_FOR_PICKUP') goToRental();
      if (payload.status === 'CANCELLED') setError('A reserva expirou. Escolha o objeto de novo.');
    },
  });

  const remainingMs = rental ? Date.parse(rental.reservationExpiresAt) - now : 0;
  const expired = rental !== null && remainingMs <= 0;

  const handleCopy = async () => {
    if (!payment) return;
    try {
      await navigator.clipboard.writeText(payment.pixCopyPaste);
    } catch {
      // Navegadores sem permissão de área de transferência: seleciona o texto como alternativa
      const el = document.getElementById('pix-code');
      if (el) window.getSelection()?.selectAllChildren(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulatePayment = async () => {
    if (!rentalId) return;
    setPaying(true);
    try {
      await api.confirmPixPaymentMock(rentalId);
      goToRental();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar o pagamento.');
      setPaying(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col">
      {/* Parte de cima: verde */}
      <div className="mx-auto w-full max-w-md px-5 pb-10 pt-5">
        <AppHeader />
        <p className="label-caps mt-10 text-conecta-cream/60">Pagamento</p>
        <h1 className="mt-2 text-[2.25rem] leading-[1] text-conecta-cream">Pague com Pix</h1>
        {rental && (
          <p
            className={`mt-4 inline-flex items-center gap-2 text-sm ${
              expired ? 'text-red-200' : 'text-conecta-cream/70'
            }`}
          >
            <Timer className="h-4 w-4" strokeWidth={1.75} />
            {expired ? (
              'Reserva expirada'
            ) : (
              <>
                Reserva garantida por{' '}
                <span className="font-bold tabular-nums text-conecta-lime">{clock(remainingMs)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Parte de baixo: creme */}
      <section className="flex-1 rounded-t-[2rem] bg-conecta-cream pb-10 text-conecta-deep">
        <div className="mx-auto w-full max-w-md px-5 pt-7">
          {error && (
            <div role="alert" className="mb-6 border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {error}{' '}
              <Link to="/app/catalog" className="font-bold underline">
                Voltar ao catálogo
              </Link>
            </div>
          )}

          {!rental && !error && <div className="h-64 animate-pulse rounded-card bg-conecta-mist" />}

          {rental && (
            <>
              {/* Resumo */}
              <div className="flex items-center gap-3.5 border-b border-conecta-deep/10 pb-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-conecta-mist">
                  <ItemIcon sku={rental.itemSku} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold leading-tight">
                    {itemShortName(rental.itemSku, rental.itemName)}
                  </span>
                  <span className="mt-1 block text-sm text-conecta-deep/60">
                    Porta {doorLabel(rental.doorNumber)} · {lockerShortFromId(rental.lockerId)} ·{' '}
                    {durationLabel(rental.planType, rental.durationUnits)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="label-caps block text-conecta-deep/45">Total</span>
                  <span className="text-xl font-bold">{brl(rental.totalAmountCents)}</span>
                </span>
              </div>

              {/* QR Code */}
              <div className={`mt-7 flex flex-col items-center ${expired ? 'opacity-30' : ''}`}>
                <div className="rounded-3xl bg-white p-4">
                  <QRCodeSVG
                    value={payment?.pixCopyPaste ?? rental.id}
                    size={184}
                    fgColor="#123D23"
                    bgColor="#FFFFFF"
                    level="M"
                  />
                </div>
                <p className="mt-3 text-sm text-conecta-deep/60">Escaneie no app do seu banco</p>
              </div>

              {/* Copia e cola */}
              {payment && (
                <div className="mt-7">
                  <p className="label-caps text-conecta-deep/45">Pix copia e cola</p>
                  <div className="mt-2 flex items-center gap-2 border-b border-conecta-deep/15 pb-2">
                    <span id="pix-code" className="min-w-0 flex-1 truncate font-mono text-xs text-conecta-deep/70">
                      {payment.pixCopyPaste}
                    </span>
                    <button
                      onClick={handleCopy}
                      disabled={expired}
                      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold disabled:opacity-30"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Demonstração: simula o banco */}
              <div className="mt-9">
                <Button size="lg" fullWidth loading={paying} disabled={expired} onClick={handleSimulatePayment}>
                  <Zap className="h-5 w-5" strokeWidth={2} />
                  Simular pagamento
                </Button>
                <p className="mt-3 text-center text-xs text-conecta-deep/50">
                  Demonstração: faz o papel do banco confirmando o Pix. Depois de pago, a tela muda sozinha.
                </p>
              </div>

              {expired && (
                <Link
                  to="/app/catalog"
                  className="mt-6 block text-center text-sm font-bold underline underline-offset-4"
                >
                  Escolher de novo no catálogo
                </Link>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
