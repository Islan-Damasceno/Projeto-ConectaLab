/**
 * Funções de formatação usadas em várias telas do app.
 */

/** Centavos → "R$ 4,00" */
export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Nome curto e amigável de um objeto a partir do SKU (o nome completo fica nos detalhes). */
export function itemShortName(sku: string | undefined, fallbackName: string) {
  const s = (sku ?? '').toUpperCase();
  if (s.startsWith('CALC')) return 'Calculadora científica';
  if (s.startsWith('JALECO')) return 'Jaleco de laboratório';
  if (s.startsWith('PWR')) return 'Powerbank 10.000 mAh';
  if (s.startsWith('CHARGER')) return 'Carregador USB-C 65W';
  return itemFullName(fallbackName);
}

/** Nome completo sem o "#2" das unidades repetidas. */
export const itemFullName = (name: string) => name.replace(/\s*#\d+$/, '');

/** "locker-bloco-b" → "Bloco B" */
export function lockerShortFromId(lockerId: string) {
  const match = lockerId.match(/bloco-([a-z0-9]+)/i);
  return match ? `Bloco ${match[1].toUpperCase()}` : lockerId;
}

/** Número da porta com dois dígitos: 2 → "02" */
export const doorLabel = (n: number) => String(n).padStart(2, '0');

/** Período contratado: "2 horas", "1 dia" */
export function durationLabel(planType: 'HOURLY' | 'DAILY', units: number) {
  if (planType === 'HOURLY') return `${units} ${units === 1 ? 'hora' : 'horas'}`;
  return `${units} ${units === 1 ? 'dia' : 'dias'}`;
}

/** Milissegundos → "09:42" (ou "1:05:09" acima de uma hora) */
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
