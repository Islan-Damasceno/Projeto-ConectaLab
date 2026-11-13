import React from 'react';
import type { DoorStatus } from '../../shared/types.js';

/**
 * Componentes base do app ConectaLab.
 * Estilo tirado do crachá: fundo verde, cartões creme bem arredondados,
 * títulos em verde escuro peso 800 e etiquetas verde-limão em caixa alta.
 */

type ButtonVariant = 'primary' | 'lime' | 'outline' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  // verde escuro com texto limão — ação principal dentro de cartões creme
  primary: 'bg-conecta-deep text-conecta-lime hover:bg-conecta-green',
  // limão com texto verde escuro — ação principal sobre fundo verde
  lime: 'bg-conecta-lime text-conecta-deep hover:brightness-95',
  // contorno — ações secundárias em cartões creme
  outline: 'border-2 border-conecta-deep/20 text-conecta-deep hover:border-conecta-deep/50',
  // discreto — links e ações terciárias sobre fundo verde
  ghost: 'text-conecta-cream/80 hover:text-conecta-cream',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const sizeClass = size === 'lg' ? 'py-4 px-6 text-lg' : 'py-3 px-5 text-base';
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-extrabold transition
        active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40
        ${sizeClass} ${buttonStyles[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-label="Carregando"
    />
  );
}

/** Cartão creme arredondado, igual ao bloco do nome no crachá. */
export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-card bg-conecta-cream p-6 text-conecta-deep shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** Etiqueta em caixa alta (como "EQUIPE CONECTALAB" no crachá). */
export function Tag({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full bg-conecta-deep px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-conecta-lime ${className}`}
    >
      {children}
    </span>
  );
}

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, id, className = '', ...rest }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="mb-1.5 block text-sm font-bold text-conecta-deep">{label}</span>
      <input
        id={inputId}
        className={`w-full rounded-2xl border-2 bg-white px-4 py-3 text-base text-conecta-deep outline-none transition
          placeholder:text-conecta-deep/35 focus:border-conecta-green
          ${error ? 'border-red-500' : 'border-conecta-mist'} ${className}`}
        {...rest}
      />
      {error ? (
        <span className="mt-1.5 block text-sm font-semibold text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-conecta-deep/55">{hint}</span>
      ) : null}
    </label>
  );
}

/** Rótulo e cor de cada status de porta, em português, para o aluno. */
export const doorStatusInfo: Record<DoorStatus, { label: string; className: string }> = {
  AVAILABLE: { label: 'Disponível', className: 'bg-conecta-lime text-conecta-deep' },
  RESERVED: { label: 'Reservado', className: 'bg-amber-200 text-amber-900' },
  AWAITING_PICKUP: { label: 'Aguardando retirada', className: 'bg-amber-200 text-amber-900' },
  OCCUPIED_RENTED: { label: 'Alugado', className: 'bg-conecta-mist text-conecta-deep/70' },
  IN_PREPARATION: { label: 'Higienizando', className: 'bg-sky-200 text-sky-900' },
  MAINTENANCE: { label: 'Manutenção', className: 'bg-red-200 text-red-900' },
};

export function StatusBadge({ status }: { status: DoorStatus }) {
  const info = doorStatusInfo[status];
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ${info.className}`}>
      {info.label}
    </span>
  );
}
