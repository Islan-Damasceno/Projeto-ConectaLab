import { BatteryCharging, Calculator, PlugZap, Shirt } from 'lucide-react';

/** Ícone de traço simples para cada tipo de objeto, pelo SKU. */
export function ItemIcon({ sku, className }: { sku?: string; className?: string }) {
  const s = (sku ?? '').toUpperCase();
  const props = { className, strokeWidth: 1.75 };
  if (s.startsWith('CALC')) return <Calculator {...props} />;
  if (s.startsWith('JALECO')) return <Shirt {...props} />;
  if (s.startsWith('PWR')) return <BatteryCharging {...props} />;
  return <PlugZap {...props} />;
}
