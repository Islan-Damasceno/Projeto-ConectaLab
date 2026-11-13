import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { LogoMark, Slogan, Wordmark } from '../../components/Logo.js';
import { Button, Card, Tag, TextField } from '../../components/ui.js';

/**
 * Tela 1 de 4: Login Rápido Institucional (/app/login — RF01)
 * Card FE-01.1 (Dev 1 - Frontend)
 *
 * - Mobile-first, no estilo do crachá (fundo verde + cartão creme).
 * - Valida no próprio celular o domínio @faculdade.edu.br / @aluno.faculdade.edu.br.
 * - Botões de preenchimento rápido para a demonstração na feira.
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
    <main className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col px-5 pb-8 pt-6">
      {/* Cabeçalho no estilo editorial: logo pequeno + ajuda em cima, nome gigante na largura toda */}
      <header>
        <div className="flex items-center justify-between">
          <LogoMark size={36} />
          <span className="label-caps text-conecta-cream/70">Ajuda</span>
        </div>
        <h1 className="mt-6 leading-[0.85]">
          <Wordmark className="block text-[min(15.6vw,4.4rem)] tracking-[-0.04em]" />
        </h1>
        <Slogan className="mt-3 text-lg" />
      </header>

      <div className="h-10" />

      <Card>
        <Tag>Acesso institucional</Tag>
        <h1 className="mt-4 text-4xl text-conecta-deep">Entrar</h1>
        <p className="mt-1 text-conecta-deep/70">Use seu e-mail da faculdade. Leva menos de 1 minuto.</p>

        {error && (
          <div role="alert" className="mt-4 rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <TextField
            label="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Lucas Andrade"
            autoComplete="name"
            error={fieldErrors.name}
          />
          <TextField
            label="RA"
            value={ra}
            onChange={(e) => setRa(e.target.value.replace(/\D/g, ''))}
            placeholder="Ex.: 20261045"
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
          <Button type="submit" size="lg" fullWidth loading={loading}>
            Entrar
          </Button>
        </form>

        <div className="mt-6 border-t border-conecta-mist pt-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-conecta-deep/50">
            Demonstração rápida
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DEMO_USERS.map((user) => (
              <Button
                key={user.email}
                type="button"
                variant="outline"
                onClick={() => fillDemo(user)}
                className="!px-3 !py-2 text-sm"
              >
                {user.name}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <footer className="mt-auto pt-8 text-center text-sm text-conecta-cream/60">
        Feira Engineering Innovation · 2026
      </footer>
    </main>
  );
}
