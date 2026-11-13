import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { LogoMark, Wordmark } from '../../components/Logo.js';
import { Button, SectionLabel, TextField } from '../../components/ui.js';

/**
 * Tela 1 de 4: Login Rápido Institucional (/app/login — RF01)
 * Card FE-01.1 (Dev 1 - Frontend)
 *
 * Estilo editorial minimalista: bloco verde de "campanha" com o slogan
 * em letras grandes condensadas, e formulário limpo sobre o creme.
 */

const INSTITUTIONAL_EMAIL = /^[^\s@]+@(aluno\.)?faculdade\.edu\.br$/i;

const DEMO_USERS = [
  { name: 'Lucas Andrade', ra: '20261045', email: 'lucas.andrade@faculdade.edu.br' },
  { name: 'Beatriz Silva', ra: '20262089', email: 'beatriz.silva@faculdade.edu.br' },
];

type FieldErrors = Partial<Record<'name' | 'ra' | 'email', string>>;

function validate(name: string, ra: string, email: string): FieldErrors {
  const errors: FieldErrors = {};
  if (name.trim().length < 3) errors.name = 'Digite seu nome completo.';
  if (!/^\d{6,12}$/.test(ra.trim())) errors.ra = 'O RA tem só números (6 a 12 dígitos).';
  if (!INSTITUTIONAL_EMAIL.test(email.trim())) {
    errors.email = 'Use seu e-mail da faculdade (@faculdade.edu.br).';
  }
  return errors;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = React.useState('');
  const [ra, setRa] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const fillDemo = (user: (typeof DEMO_USERS)[number]) => {
    setName(user.name);
    setRa(user.ra);
    setEmail(user.email);
    setFieldErrors({});
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const errors = validate(name, ra, email);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const res = await api.quickLogin({ name: name.trim(), ra: ra.trim(), email: email.trim() });
      navigate(res.activeRentalId ? `/app/rental/${res.activeRentalId}` : '/app/catalog');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar. Tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-2.5rem)] bg-conecta-cream text-conecta-deep">
      {/* Bloco de "campanha" */}
      <section className="bg-conecta-green text-conecta-cream">
        <div className="mx-auto flex min-h-[52vh] max-w-md flex-col px-6 pb-8 pt-5">
          <header className="flex items-center justify-between">
            <Wordmark className="text-xl" />
            <span className="label-caps text-conecta-cream/70">Ajuda</span>
          </header>

          <div className="flex flex-1 items-center justify-end py-6">
            <LogoMark size={104} />
          </div>

          <h1 className="font-condensed text-[64px] uppercase leading-[0.86]">
            Pegou,
            <br />
            usou,
            <br />
            <span className="text-conecta-lime">devolveu.</span>
          </h1>
          <p className="label-caps mt-5 text-conecta-cream/70">Armários inteligentes no campus</p>
        </div>
      </section>

      {/* Formulário */}
      <section className="mx-auto max-w-md px-6 pb-10 pt-10">
        <div className="flex items-baseline justify-between">
          <SectionLabel>Iniciar sessão</SectionLabel>
          <span className="text-xs text-conecta-deep/50">Menos de 1 minuto</span>
        </div>

        {error && (
          <p role="alert" className="mt-6 border-l-2 border-red-600 pl-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-7">
          <TextField
            label="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            error={fieldErrors.name}
          />
          <TextField
            label="RA"
            value={ra}
            onChange={(e) => setRa(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            error={fieldErrors.ra}
          />
          <TextField
            label="E-mail institucional"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu.nome@faculdade.edu.br"
            autoComplete="email"
            autoCapitalize="none"
            error={fieldErrors.email}
          />
          <div className="pt-3">
            <Button type="submit" size="lg" fullWidth loading={loading}>
              Entrar
            </Button>
          </div>
        </form>

        <div className="mt-12">
          <SectionLabel className="text-conecta-deep/50">Acesso de demonstração</SectionLabel>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {DEMO_USERS.map((user) => (
              <Button
                key={user.email}
                type="button"
                variant="outline"
                onClick={() => fillDemo(user)}
                className="!tracking-[0.12em] !text-[11px]"
              >
                {user.name}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-conecta-deep/10 py-6 text-center">
        <span className="label-caps text-conecta-deep/40">Feira Engineering Innovation · 2026</span>
      </footer>
    </div>
  );
}
