import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryCharging, Calculator, MapPin, Minus, Plus, PlugZap, Shirt, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import { AppHeader } from '../../components/AppHeader.js';
import { Button, StatusBadge } from '../../components/ui.js';
import type { CatalogItem, DoorWithItem, Locker, PlanType } from '../../../shared/types.js';

/**
 * Tela 2 de 4: Catálogo por Armário e Seleção de Período (/app/catalog — RF02, RF03, RF04)
 * Cards FE-01.2, FE-01.3 e FE-01.4 (Dev 1 - Frontend)
 *
 * - Abas por armário (Bloco A / Bloco B) com a localização.
 * - Grade de objetos estilo vitrine, com status de cada porta.
 * - Ao tocar num objeto disponível, abre um painel com plano (hora/diária),
 *   quantidade e preço total, e o botão de reservar.
 * - Atualiza sozinho quando outra pessoa reserva (evento CATALOG_STOCK_UPDATED).
 */

const MAX_UNITS = 8;

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "Armário Bloco B — Laboratórios e Saúde" → { short: "Bloco B", area: "Laboratórios e Saúde" } */
function lockerLabel(locker: Locker) {
  const [left, area] = locker.name.split(' — ');
  return { short: left.replace(/^Armário\s+/i, ''), area: area ?? '' };
}

/** Nome curto para o card (o nome completo aparece no painel de reserva). */
function shortName(item: CatalogItem) {
  const sku = item.sku.toUpperCase();
  if (sku.startsWith('CALC')) return 'Calculadora científica';
  if (sku.startsWith('JALECO')) return 'Jaleco de laboratório';
  if (sku.startsWith('PWR')) return 'Powerbank 10.000 mAh';
  if (sku.startsWith('CHARGER')) return 'Carregador USB-C 65W';
  return item.name.replace(/\s*#\d+$/, '');
}

/** Nome completo sem o "#2" das unidades repetidas. */
const fullName = (item: CatalogItem) => item.name.replace(/\s*#\d+$/, '');

function ItemIcon({ item, className }: { item: CatalogItem; className?: string }) {
  const sku = item.sku.toUpperCase();
  const props = { className, strokeWidth: 1.75 };
  if (sku.startsWith('CALC')) return <Calculator {...props} />;
  if (sku.startsWith('JALECO')) return <Shirt {...props} />;
  if (sku.startsWith('PWR')) return <BatteryCharging {...props} />;
  return <PlugZap {...props} />;
}

export function CatalogPage() {
  const navigate = useNavigate();
  const [lockers, setLockers] = React.useState<Locker[]>([]);
  const [selectedLockerId, setSelectedLockerId] = React.useState('locker-bloco-b');
  const [doors, setDoors] = React.useState<DoorWithItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Painel de reserva
  const [selectedDoorId, setSelectedDoorId] = React.useState<string | null>(null);
  const [planType, setPlanType] = React.useState<PlanType>('HOURLY');
  const [units, setUnits] = React.useState(2);
  const [reserving, setReserving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const loadCatalog = React.useCallback(async (lockerId: string) => {
    const [{ lockers: list }, catalog] = await Promise.all([
      api.listLockers(),
      api.getLockerCatalog(lockerId),
    ]);
    setLockers([...list].sort((a, b) => a.name.localeCompare(b.name)));
    setDoors(catalog.doors);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    setLoading(true);
    setSelectedDoorId(null);
    void loadCatalog(selectedLockerId);
  }, [selectedLockerId, loadCatalog]);

  // Tempo real: alguém reservou/devolveu → recarrega a vitrine
  useConectaWs({
    clientType: 'STUDENT',
    onEvent: (envelope) => {
      if (envelope.event === 'CATALOG_STOCK_UPDATED') {
        void loadCatalog(selectedLockerId);
      }
    },
  });

  const selectedDoor = doors.find((d) => d.id === selectedDoorId) ?? null;

  // Se a porta escolhida deixou de estar disponível (outra pessoa reservou), fecha o painel
  React.useEffect(() => {
    if (selectedDoor && selectedDoor.status !== 'AVAILABLE' && !reserving) {
      setSelectedDoorId(null);
      setNotice('Alguém acabou de reservar esse objeto. Escolha outro disponível.');
    }
  }, [selectedDoor, reserving]);

  const openDoor = (door: DoorWithItem) => {
    if (door.status !== 'AVAILABLE') return;
    setNotice(null);
    setSelectedDoorId(door.id);
    setPlanType('HOURLY');
    setUnits(2);
  };

  const changePlan = (plan: PlanType) => {
    setPlanType(plan);
    setUnits(plan === 'HOURLY' ? 2 : 1);
  };

  const selectedItem = selectedDoor?.item ?? null;
  const unitPrice = selectedDoor?.item
    ? planType === 'HOURLY'
      ? selectedDoor.item.hourlyPriceCents
      : selectedDoor.item.dailyPriceCents
    : 0;
  const total = unitPrice * units;
  const unitWord = planType === 'HOURLY' ? (units === 1 ? 'hora' : 'horas') : units === 1 ? 'dia' : 'dias';

  const handleReserve = async () => {
    if (!selectedDoor) return;
    setReserving(true);
    setNotice(null);
    try {
      const res = await api.createRental({ doorId: selectedDoor.id, planType, durationUnits: units });
      navigate(`/app/checkout/${res.rental.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Não foi possível reservar. Tente de novo.');
      setReserving(false);
      void loadCatalog(selectedLockerId);
    }
  };

  const currentLocker = lockers.find((l) => l.id === selectedLockerId);
  const availableCount = doors.filter((d) => d.status === 'AVAILABLE').length;

  return (
    <main className={`mx-auto w-full max-w-md px-5 pt-5 ${selectedDoor ? 'pb-96' : 'pb-10'}`}>
      <AppHeader />

      <h1 className="mt-8 text-[2.5rem] leading-[0.95] text-conecta-cream">
        Do que você <span className="text-conecta-lime">precisa</span> hoje?
      </h1>

      {/* Abas dos armários */}
      <div className="mt-6 grid grid-cols-2 gap-2" role="tablist">
        {lockers.map((locker) => {
          const active = locker.id === selectedLockerId;
          return (
            <button
              key={locker.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedLockerId(locker.id)}
              className={`rounded-full py-3 text-base font-extrabold transition ${
                active
                  ? 'bg-conecta-cream text-conecta-deep'
                  : 'border border-conecta-cream/25 text-conecta-cream/80 hover:border-conecta-cream/60'
              }`}
            >
              {lockerLabel(locker).short}
            </button>
          );
        })}
      </div>

      {currentLocker && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-conecta-cream/70">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>
            {currentLocker.buildingLocation} · {availableCount} de {doors.length} disponíveis
          </span>
        </p>
      )}

      {notice && !selectedDoor && (
        <p role="alert" className="mt-4 rounded-2xl bg-amber-200 px-4 py-3 text-sm font-semibold text-amber-900">
          {notice}
        </p>
      )}

      {/* Vitrine */}
      <section className="mt-6 grid grid-cols-2 gap-3" aria-busy={loading}>
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-52 animate-pulse rounded-card bg-conecta-cream/10" />
            ))
          : doors.map((door) => {
              if (!door.item) return null;
              const available = door.status === 'AVAILABLE';
              const selected = door.id === selectedDoorId;
              return (
                <button
                  key={door.id}
                  onClick={() => openDoor(door)}
                  disabled={!available}
                  className={`flex flex-col rounded-card bg-conecta-cream p-4 text-left text-conecta-deep transition
                    ${available ? 'active:scale-[0.98]' : 'cursor-not-allowed opacity-55'}
                    ${selected ? 'ring-4 ring-conecta-lime' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                        available ? 'bg-conecta-lime' : 'bg-conecta-mist'
                      }`}
                    >
                      <ItemIcon item={door.item} className="h-6 w-6 text-conecta-deep" />
                    </span>
                    <span className="label-caps text-conecta-deep/50">
                      Porta {String(door.doorNumber).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="mt-4 min-h-[2.5rem] text-lg font-extrabold leading-tight">
                    {shortName(door.item)}
                  </span>
                  <span className="mt-2 text-base font-extrabold">{brl(door.item.hourlyPriceCents)}/h</span>
                  <span className="text-sm text-conecta-deep/60">ou {brl(door.item.dailyPriceCents)}/dia</span>
                  <span className="mt-3">
                    <StatusBadge status={door.status} />
                  </span>
                </button>
              );
            })}
      </section>

      {/* Painel de reserva */}
      {selectedDoor?.item && (
        <div className="fixed inset-x-0 bottom-0 z-20">
          <div className="mx-auto max-w-md rounded-t-[2rem] bg-conecta-cream px-5 pb-6 pt-5 text-conecta-deep shadow-[0_-12px_40px_rgba(0,0,0,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-caps text-conecta-deep/50">
                  Porta {String(selectedDoor.doorNumber).padStart(2, '0')} ·{' '}
                  {currentLocker ? lockerLabel(currentLocker).short : ''}
                </p>
                <h2 className="mt-1 text-xl leading-tight">{fullName(selectedDoor.item)}</h2>
              </div>
              <button
                onClick={() => setSelectedDoorId(null)}
                aria-label="Fechar"
                className="rounded-full p-2 hover:bg-conecta-mist"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Plano */}
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-conecta-mist p-1">
              {(['HOURLY', 'DAILY'] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => changePlan(plan)}
                  className={`rounded-full py-2.5 text-sm font-extrabold transition ${
                    planType === plan ? 'bg-conecta-deep text-conecta-lime' : 'text-conecta-deep/70'
                  }`}
                >
                  {plan === 'HOURLY'
                    ? `Por hora · ${brl(selectedItem!.hourlyPriceCents)}`
                    : `Diária · ${brl(selectedItem!.dailyPriceCents)}`}
                </button>
              ))}
            </div>

            {/* Quantidade + total */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setUnits((u) => Math.max(1, u - 1))}
                  disabled={units <= 1}
                  aria-label="Diminuir"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-conecta-deep/20 disabled:opacity-30"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[4.5rem] text-center">
                  <span className="block text-2xl font-extrabold leading-none">{units}</span>
                  <span className="text-xs text-conecta-deep/60">{unitWord}</span>
                </span>
                <button
                  onClick={() => setUnits((u) => Math.min(MAX_UNITS, u + 1))}
                  disabled={units >= MAX_UNITS}
                  aria-label="Aumentar"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-conecta-deep/20 disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="text-right">
                <span className="label-caps block text-conecta-deep/50">Total</span>
                <span className="text-3xl font-extrabold">{brl(total)}</span>
              </div>
            </div>

            {notice && (
              <p role="alert" className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-semibold text-red-800">
                {notice}
              </p>
            )}

            <Button size="lg" fullWidth loading={reserving} onClick={handleReserve} className="mt-5">
              Reservar · {brl(total)}
            </Button>
            <p className="mt-3 text-center text-xs text-conecta-deep/55">
              A porta fica reservada por 10 minutos enquanto você paga com Pix.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
