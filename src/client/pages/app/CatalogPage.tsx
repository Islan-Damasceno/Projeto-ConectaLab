import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryCharging, Calculator, ChevronRight, MapPin, Minus, Plus, PlugZap, Shirt, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useConectaWs } from '../../lib/ws-client.js';
import { AppHeader } from '../../components/AppHeader.js';
import { Button, doorStatusInfo } from '../../components/ui.js';
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

      <h1 className="mt-10 text-[2.25rem] leading-[1] text-conecta-cream">Do que você precisa hoje?</h1>

      {/* Abas dos armários: texto com sublinhado */}
      <div className="mt-8 flex gap-8 border-b border-conecta-cream/15" role="tablist">
        {lockers.map((locker) => {
          const active = locker.id === selectedLockerId;
          return (
            <button
              key={locker.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedLockerId(locker.id)}
              className={`label-caps -mb-px border-b-2 pb-3 transition-colors ${
                active
                  ? 'border-conecta-lime text-conecta-cream'
                  : 'border-transparent text-conecta-cream/45 hover:text-conecta-cream/80'
              }`}
            >
              {lockerLabel(locker).short}
            </button>
          );
        })}
      </div>

      {currentLocker && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-conecta-cream/55">
          <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate">{currentLocker.buildingLocation}</span>
          <span className="shrink-0">· {availableCount}/{doors.length} livres</span>
        </p>
      )}

      {notice && !selectedDoor && (
        <p role="alert" className="mt-5 border-l-2 border-amber-300 pl-3 text-sm text-amber-100">
          {notice}
        </p>
      )}

      {/* Lista de objetos dentro de um cartão creme (mesmo cartão do login) */}
      <ul className="mt-6 overflow-hidden rounded-card bg-conecta-cream px-5" aria-busy={loading}>
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="h-[84px] animate-pulse border-b border-conecta-deep/10 last:border-0" />
            ))
          : doors.map((door) => {
              if (!door.item) return null;
              const available = door.status === 'AVAILABLE';
              const selected = door.id === selectedDoorId;
              return (
                <li key={door.id} className="border-b border-conecta-deep/10 last:border-0">
                  <button
                    onClick={() => openDoor(door)}
                    disabled={!available}
                    className={`flex w-full items-center gap-3.5 py-5 text-left transition-opacity
                      ${available ? '' : 'cursor-not-allowed opacity-45'}`}
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors ${
                        selected ? 'bg-conecta-deep text-conecta-lime' : 'bg-conecta-mist text-conecta-deep'
                      }`}
                    >
                      <ItemIcon item={door.item} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-bold leading-tight text-conecta-deep">
                        {shortName(door.item)}
                      </span>
                      <span className="mt-1 block text-sm text-conecta-deep/60">
                        Porta {String(door.doorNumber).padStart(2, '0')} · {brl(door.item.hourlyPriceCents)}/h
                      </span>
                    </span>
                    {available ? (
                      <span className="flex shrink-0 items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-conecta-lime ring-1 ring-conecta-deep/30"
                          aria-label="Disponível"
                        />
                        <ChevronRight className="h-4 w-4 text-conecta-deep/40" strokeWidth={1.75} />
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-conecta-deep/70">
                        {doorStatusInfo[door.status].label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
      </ul>

      {/* Painel de reserva */}
      {selectedDoor?.item && (
        <div className="fixed inset-x-0 bottom-0 z-20">
          <div className="mx-auto max-w-md rounded-t-[1.75rem] bg-conecta-cream px-6 pb-6 pt-6 text-conecta-deep shadow-[0_-8px_32px_rgba(0,0,0,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-caps text-conecta-deep/45">
                  Porta {String(selectedDoor.doorNumber).padStart(2, '0')} ·{' '}
                  {currentLocker ? lockerLabel(currentLocker).short : ''}
                </p>
                <h2 className="mt-2 text-xl font-bold leading-tight tracking-normal">
                  {fullName(selectedDoor.item)}
                </h2>
              </div>
              <button
                onClick={() => setSelectedDoorId(null)}
                aria-label="Fechar"
                className="-mr-2 -mt-1 p-2 text-conecta-deep/50 hover:text-conecta-deep"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>

            {/* Plano: abas sublinhadas */}
            <div className="mt-6 flex gap-6 border-b border-conecta-deep/10">
              {(['HOURLY', 'DAILY'] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => changePlan(plan)}
                  className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                    planType === plan
                      ? 'border-conecta-deep font-semibold text-conecta-deep'
                      : 'border-transparent text-conecta-deep/45'
                  }`}
                >
                  {plan === 'HOURLY'
                    ? `Por hora · ${brl(selectedItem!.hourlyPriceCents)}`
                    : `Diária · ${brl(selectedItem!.dailyPriceCents)}`}
                </button>
              ))}
            </div>

            {/* Quantidade + total */}
            <div className="mt-6 flex items-end justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setUnits((u) => Math.max(1, u - 1))}
                  disabled={units <= 1}
                  aria-label="Diminuir"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-conecta-deep/20 disabled:opacity-30"
                >
                  <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <span className="min-w-[3.5rem] text-center text-sm">
                  <span className="font-semibold">{units}</span> {unitWord}
                </span>
                <button
                  onClick={() => setUnits((u) => Math.min(MAX_UNITS, u + 1))}
                  disabled={units >= MAX_UNITS}
                  aria-label="Aumentar"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-conecta-deep/20 disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <div className="text-right">
                <span className="label-caps block text-conecta-deep/45">Total</span>
                <span className="text-2xl font-bold">{brl(total)}</span>
              </div>
            </div>

            {notice && (
              <p role="alert" className="mt-4 border-l-2 border-red-600 pl-3 text-sm text-red-700">
                {notice}
              </p>
            )}

            <Button size="lg" fullWidth loading={reserving} onClick={handleReserve} className="mt-6">
              Reservar
            </Button>
            <p className="mt-3 text-center text-xs text-conecta-deep/50">
              Reservado por 10 min enquanto você paga com Pix.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
