import React from 'react';
import type { DoorStatus } from '../../shared/types.js';

/**
 * Componentes base do app ConectaLab.
 * Linguagem visual minimalista e editorial: fundo creme como "papel",
 * verde escuro como "tinta", limão só como destaque; sem cantos
 * arredondados nem sombras; rótulos pequenos em caixa alta e espaçados;
 * campos marcados só por uma linha embaixo.
 */

type ButtonVariant = 'primary' | 'lime' | 'outline' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-conecta-deep text-conecta-cream hover:bg-conecta-green',
  lime: 'bg-conecta-lime text-conecta-deep hover:brightness-95',
  outline:
    'border border-conecta-deep text-conecta-deep hover:bg-conecta-deep hover:text-conecta-cream',
  ghost: 'text-conecta-deep underline-offset-4 hover:underline',
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
  const sizeClass = size === 'lg' ? 'h-14 px-6' : 'h-12 px-5';
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 text-[13px] font-semibold uppercase tracking-[0.2em]
        transition-colors disabled:cursor-not-allowed disabled:opacity-30
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
      className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent"
      aria-label="Carregando"
    />
  );
}

/** Bloco com borda fina, sem sombra nem arredondado. */
export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`border border-conecta-deep/15 p-5 text-conecta-deep ${className}`}>{children}</div>;
}

/** Rótulo de seção em caixa alta (ex.: "INICIAR SESSÃO"). */
export function SectionLabel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <p className={`label-caps ${className}`}>{children}</p>;
}

/** Etiqueta pequena com contorno fino. */
export function Tag({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block border border-current px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${className}`}>
      {children}
    </span>
  );
}

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

/** Campo só com a linha de baixo, rótulo pequeno em caixa alta. */
export function TextField({ label, hint, error, id, className = '', ...rest }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="label-caps block text-conecta-deep/60">{label}</span>
      <input
        id={inputId}
        className={`w-full border-0 border-b border-solid bg-transparent px-0 py-3 text-base text-conecta-deep outline-none transition-colors
          placeholder:text-conecta-deep/30 focus:border-conecta-deep
          ${error ? 'border-red-600' : 'border-conecta-deep/25'} ${className}`}
        {...rest}
      />
      {error ? (
        <span className="mt-2 block text-xs text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-2 block text-xs text-conecta-deep/55">{hint}</span>
      ) : null}
    </label>
  );
}

/** Rótulo e cor do indicador de cada status de porta, em português. */
export const doorStatusInfo: Record<DoorStatus, { label: string; dot: string }> = {
  AVAILABLE: { label: 'Disponível', dot: 'bg-conecta-lime ring-1 ring-conecta-deep/40' },
  RESERVED: { label: 'Reservado', dot: 'bg-amber-400' },
  AWAITING_PICKUP: { label: 'Aguardando retirada', dot: 'bg-amber-400' },
  OCCUPIED_RENTED: { label: 'Alugado', dot: 'bg-conecta-deep/30' },
  IN_PREPARATION: { label: 'Higienizando', dot: 'bg-sky-400' },
  MAINTENANCE: { label: 'Manutenção', dot: 'bg-red-500' },
};

export function StatusBadge({ status }: { status: DoorStatus }) {
  const info = doorStatusInfo[status];
  return (
    <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-conecta-deep">
      <span className={`h-2 w-2 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}
