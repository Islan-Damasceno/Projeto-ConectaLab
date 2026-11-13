/**
 * Logo ConectaLab recriado em SVG a partir da arte oficial:
 * um "C" em forma de seta de ciclo (a devolução), com um ponto no início,
 * envolvendo um armário de duas portas (a de cima em verde-limão = disponível).
 */
export function LogoMark({ size = 96, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="500 330 600 600"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Logo ConectaLab"
    >
      <path d="M993 468 A252 252 0 1 0 1016 760" fill="none" stroke="#C6F04D" strokeWidth="76" />
      <polygon points="1066,686 955,722 1082,795" fill="#C6F04D" />
      <circle cx="995" cy="466" r="48" fill="#F6F3E8" />
      <rect x="708" y="494" width="182" height="128" rx="22" fill="#C6F04D" />
      <rect x="708" y="638" width="182" height="130" rx="22" fill="#F6F3E8" />
      <rect x="843" y="533" width="15" height="50" rx="7.5" fill="#1B5632" />
      <rect x="843" y="678" width="15" height="50" rx="7.5" fill="#1B5632" />
    </svg>
  );
}

/**
 * Nome "ConectaLab". Sobre fundo verde: creme + "Lab" em limão (original).
 * Sobre fundo creme: verde escuro + "Lab" em verde principal (limão some no creme).
 */
export function Wordmark({
  className = 'text-2xl',
  tone = 'onDark',
}: {
  className?: string;
  tone?: 'onDark' | 'onLight';
}) {
  const base = tone === 'onDark' ? 'text-conecta-cream' : 'text-conecta-deep';
  const lab = tone === 'onDark' ? 'text-conecta-lime' : 'text-conecta-green';
  return (
    <span className={`font-extrabold tracking-tight ${base} ${className}`}>
      Conecta<span className={lab}>Lab</span>
    </span>
  );
}

/** Slogan com "devolveu." em destaque, como no crachá. */
export function Slogan({ className = '' }: { className?: string }) {
  return (
    <p className={`text-conecta-cream/80 ${className}`}>
      Pegou, usou, <strong className="font-extrabold text-conecta-lime">devolveu.</strong>
    </p>
  );
}
