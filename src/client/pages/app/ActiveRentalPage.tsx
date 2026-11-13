import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, DoorOpen, Lock, PackageCheck, Unlock } from 'lucide-react';
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
import type { Rental } from '../../../shared/types.js';

/**
 * Tela 4 de 4: Retirada, Locação Ativa e Devolução (/app/rental/:rentalId — RF06, RF07, RF08)
 * Cards FE-02.3, FE-02.4 e FE-02.5 (Dev 1 - Frontend)
 *
 * A tela muda conforme o status da locação:
 *   1. Pago, porta trancada  → botão "Destravar porta" (nunca aparece sem pagamento — RN03)
 *   2. Porta aberta          → "Retire o objeto e feche a porta" (espera o armário avisar)
 *   3. Em uso                → cronômetro até a hora da devolução + botão "Devolver"
 *   4. Aguardando devolução  → "Guarde o objeto e feche a porta" (mesma porta — RN04)
 *   5. Concluída             → recibo
 * As mudanças chegam sozinhas pelo evento RENTAL_STATUS_UPDATED (sem recarregar a página).
 */

type Stage = 'PICKUP' | 'DOOR_OPEN' | 'IN_USE' | 'RETURNING' | 'DONE' | 'CANCELLED';

function stageOf(rental: Rental, doorUnlocked: boolean): Stage | 'UNPAID' {
  switch (rental.status) {
    case 'CREATED':
    case 'AWAITING_PAYMENT':
      return 'UNPAID';
    case 'PAID_READY_FOR_PICKUP':
      return doorUnlocked || rental.doorLockState === 'UNLOCKED' ? 'DOOR_OPEN' : 'PICKUP';
    case 'IN_USE':
      return 'IN_USE';
    case 'AWAITING_RETURN_CLOSE':
      return 'RETURNING';
    case 'COMPLETED':
      return 'DONE';
    default:
      return 'CANCELLED';
  }
}

const STEPS = ['Retirada', 'Em uso', 'Devolução'] as const;
const stepIndex: Record<Stage, number> = {
  PICKUP: 0,
  DOOR_OPEN: 0,
  IN_USE: 1,
  RETURNING: 2,
  DONE: 3,
  CANCELLED: 0,
};

const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

export function ActiveRentalPage() {
  const { rentalId } = useParams<{ rentalId: string }>();
  const navigate = useNavigate();
  const now = useNow();

  const [rental, setRental] = React.useState<Rental | null>(null);
  const [doorUnlocked, setDoorUnlocked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadDetails = React.useCallback(async () => {
    if (!rentalId) return;
    try {
      const res = await api.getRentalDetails(rentalId);
      setRental(res.rental);
      if (res.rental.status !== 'PAID_READY_FOR_PICKUP') setDoorUnlocked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Locação não encontrada.');
    }
  }, [rentalId]);

  React.useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  // O armário avisa quando a porta fecha → a locação muda de status
  useConectaWs({
    clientType: 'STUDENT',
    userId: rental?.userId,
    onEvent: (envelope) => {
      if (envelope.event !== 'RENTAL_STATUS_UPDATED') return;
      const payload = envelope.payload as { rentalId: string };
      if (payload.rentalId === rentalId) void loadDetails();
    },
  });

  const stage = rental ? stageOf(rental, doorUnlocked) : null;

  // Ainda não pagou: volta para o Pix (RN03 — nunca mostra "Destravar" sem pagamento)
  React.useEffect(() => {
    if (stage === 'UNPAID' && rentalId) navigate(`/app/checkout/${rentalId}`, { replace: true });
  }, [stage, rentalId, navigate]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadDetails();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = () =>
    run(async () => {
      await api.unlockRentalDoor(rentalId!);
      setDoorUnlocked(true);
    });

  const handleReturn = () => run(() => api.returnUnlockRental(rentalId!));

  if (!rental || !stage || stage === 'UNPAID') {
    return (
      <main className="mx-auto w-full max-w-md px-5 pt-5">
        <AppHeader />
        {error ? (
          <p className="mt-10 text-conecta-cream/80">
            {error}{' '}
            <Link to="/app/catalog" className="font-bold text-conecta-lime underline">
              Ir ao catálogo
            </Link>
          </p>
        ) : (
          <div className="mt-10 h-40 animate-pulse rounded-card bg-conecta-cream/10" />
        )}
      </main>
    );
  }

  const door = doorLabel(rental.doorNumber);
  const block = lockerShortFromId(rental.lockerId);
  const remainingMs = rental.expectedReturnAt ? Date.parse(rental.expectedReturnAt) - now : 0;
  const overdue = stage === 'IN_USE' && remainingMs < 0;

  const heading: Record<Stage, { label: string; title: React.ReactNode }> = {
    PICKUP: { label: 'Pagamento confirmado', title: <>Tudo certo! Vá até o armário</> },
    DOOR_OPEN: { label: 'Porta aberta', title: <>Retire o objeto e feche a porta</> },
    IN_USE: {
      label: overdue ? 'Prazo vencido' : 'Em uso',
      title: overdue ? <>Hora de devolver</> : <>Bom uso!</>,
    },
    RETURNING: { label: 'Devolução', title: <>Guarde o objeto e feche a porta</> },
    DONE: { label: 'Concluída', title: <>Devolvido. Valeu!</> },
    CANCELLED: { label: 'Cancelada', title: <>Locação cancelada</> },
  };

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col">
      {/* Parte de cima: verde */}
      <div className="mx-auto w-full max-w-md px-5 pb-10 pt-5">
        <AppHeader />
        <p className={`label-caps mt-10 ${overdue ? 'text-red-200' : 'text-conecta-cream/60'}`}>
          {heading[stage].label}
        </p>
        <h1 className="mt-2 text-[2.25rem] leading-[1] text-conecta-cream">{heading[stage].title}</h1>

        {/* Etapas */}
        {stage !== 'CANCELLED' && (
          <ol className="mt-7 grid grid-cols-3 gap-2">
            {STEPS.map((step, i) => {
              const done = i < stepIndex[stage];
              const current = i === stepIndex[stage];
              return (
                <li key={step}>
                  <span
                    className={`block h-1 rounded-full ${
                      done ? 'bg-conecta-lime' : current ? 'bg-conecta-cream' : 'bg-conecta-cream/20'
                    }`}
                  />
                  <span
                    className={`label-caps mt-2 block !text-[10px] ${
                      current ? 'text-conecta-cream' : 'text-conecta-cream/45'
                    }`}
                  >
                    {step}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Parte de baixo: creme */}
      <section className="flex-1 rounded-t-[2rem] bg-conecta-cream pb-10 text-conecta-deep">
        <div className="mx-auto w-full max-w-md px-5 pt-7">
          {/* Objeto */}
          <div className="flex items-center gap-3.5 border-b border-conecta-deep/10 pb-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-conecta-mist">
              <ItemIcon sku={rental.itemSku} className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-bold leading-tight">
                {itemShortName(rental.itemSku, rental.itemName)}
              </span>
              <span className="mt-1 block text-sm text-conecta-deep/60">
                {durationLabel(rental.planType, rental.durationUnits)} · {brl(rental.totalAmountCents)}
              </span>
            </span>
          </div>

          {error && (
            <p role="alert" className="mt-5 border-l-2 border-red-600 pl-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* 1. Pronto para retirar */}
          {stage === 'PICKUP' && (
            <>
              <DoorBadge block={block} door={door} icon={<Lock className="h-5 w-5" strokeWidth={1.75} />} />
              <Button size="lg" fullWidth loading={busy} onClick={handleUnlock} className="mt-7">
                <Unlock className="h-5 w-5" strokeWidth={2} />
                Destravar porta {door}
              </Button>
              <p className="mt-3 text-center text-xs text-conecta-deep/50">
                Toque quando estiver na frente do armário.
              </p>
            </>
          )}

          {/* 2. Porta aberta: esperando fechar */}
          {stage === 'DOOR_OPEN' && (
            <>
              <DoorBadge
                block={block}
                door={door}
                open
                icon={<DoorOpen className="h-5 w-5" strokeWidth={1.75} />}
              />
              <WaitingNote>
                Pegue o objeto e feche a porta. O cronômetro começa assim que o armário trancar.
              </WaitingNote>
            </>
          )}

          {/* 3. Em uso: cronômetro + devolver */}
          {stage === 'IN_USE' && (
            <>
              <div className="mt-8 text-center">
                <p className="label-caps text-conecta-deep/45">
                  {overdue ? 'Atrasado há' : 'Tempo restante'}
                </p>
                <p
                  className={`mt-2 text-6xl font-extrabold tabular-nums tracking-tight ${
                    overdue ? 'text-red-700' : ''
                  }`}
                >
                  {clock(Math.abs(remainingMs))}
                </p>
                <p className="mt-2 text-sm text-conecta-deep/60">
                  Devolver até {timeOf(rental.expectedReturnAt)} na porta {door} do {block}
                </p>
                {overdue && (
                  <p className="mt-3 text-sm text-red-700">Devolva o quanto antes para evitar multa por atraso.</p>
                )}
              </div>
              <Button size="lg" fullWidth loading={busy} onClick={handleReturn} className="mt-8">
                <PackageCheck className="h-5 w-5" strokeWidth={2} />
                Devolver objeto
              </Button>
              <p className="mt-3 text-center text-xs text-conecta-deep/50">
                A porta {door} abre para você guardar o objeto.
              </p>
            </>
          )}

          {/* 4. Devolvendo: esperando fechar */}
          {stage === 'RETURNING' && (
            <>
              <DoorBadge
                block={block}
                door={door}
                open
                icon={<DoorOpen className="h-5 w-5" strokeWidth={1.75} />}
              />
              <WaitingNote>Guarde o objeto e feche a porta. A devolução é confirmada na hora.</WaitingNote>
            </>
          )}

          {/* 5. Recibo */}
          {stage === 'DONE' && (
            <>
              <div className="mt-8 flex flex-col items-center text-center">
                <CheckCircle2 className="h-14 w-14 text-conecta-green" strokeWidth={1.5} />
                <p className="mt-3 text-sm text-conecta-deep/60">Recibo da locação</p>
              </div>
              <dl className="mt-6 divide-y divide-conecta-deep/10 border-y border-conecta-deep/10 text-sm">
                <ReceiptRow label="Armário" value={`${block} · porta ${door}`} />
                <ReceiptRow label="Período" value={durationLabel(rental.planType, rental.durationUnits)} />
                <ReceiptRow label="Retirado às" value={timeOf(rental.pickedUpAt)} />
                <ReceiptRow label="Devolvido às" value={timeOf(rental.returnedAt)} />
                <ReceiptRow label="Total pago (Pix)" value={brl(rental.totalAmountCents)} strong />
              </dl>
              <Button size="lg" fullWidth onClick={() => navigate('/app/catalog')} className="mt-8">
                Alugar outro objeto
              </Button>
            </>
          )}

          {stage === 'CANCELLED' && (
            <div className="mt-8">
              <p className="text-conecta-deep/70">
                {rental.cancelReason === 'EXPIRED_TTL'
                  ? 'O pagamento não foi feito a tempo e a reserva expirou.'
                  : 'Esta locação foi cancelada.'}
              </p>
              <Button size="lg" fullWidth onClick={() => navigate('/app/catalog')} className="mt-6">
                Voltar ao catálogo
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** Bloco grande com o armário e a porta (o que o aluno procura no corredor). */
function DoorBadge({
  block,
  door,
  icon,
  open = false,
}: {
  block: string;
  door: string;
  icon: React.ReactNode;
  open?: boolean;
}) {
  return (
    <div className="mt-7 flex items-center justify-between rounded-card bg-conecta-mist/70 px-6 py-5">
      <div>
        <p className="label-caps text-conecta-deep/50">{block}</p>
        <p className="mt-1 text-sm text-conecta-deep/60">Porta</p>
        <p className="text-6xl font-extrabold leading-none tracking-tight">{door}</p>
      </div>
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full ${
          open ? 'animate-pulse bg-conecta-lime text-conecta-deep' : 'bg-conecta-deep text-conecta-cream'
        }`}
      >
        {icon}
      </span>
    </div>
  );
}

function WaitingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 flex items-start gap-3 text-sm text-conecta-deep/70">
      <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-conecta-green" />
      {children}
    </p>
  );
}

function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-conecta-deep/60">{label}</dt>
      <dd className={strong ? 'text-base font-extrabold' : 'font-semibold'}>{value}</dd>
    </div>
  );
}
