import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';

/**
 * Tela 1 de 4: Login Rápido Institucional (/app/login — RF01)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-01)
 *
 * // TODO: [FE-01] (Dev 1 - Frontend):
 * - Estilizar tela Mobile-First conforme wireframe da Seção 5.1 do SPEC.md.
 * - Validar domínio `@faculdade.edu.br` e adicionar botões de preenchimento rápido (1-Click Demo).
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = React.useState('Lucas Andrade');
  const [ra, setRa] = React.useState('20261045');
  const [email, setEmail] = React.useState('lucas.andrade@faculdade.edu.br');
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.quickLogin({ name, ra, email });
      if (res.activeRentalId) {
        navigate(`/app/rental/${res.activeRentalId}`);
      } else {
        navigate('/app/catalog');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar');
    }
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">ConectaLab — Acesso Institucional</h1>
      <p className="text-sm text-slate-400 mb-6">
        TODO [FE-01]: Completar UI Mobile-First do Login Institucional (RF01).
      </p>
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-200 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          className="w-full p-3 rounded bg-slate-900 border border-slate-700"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome Completo"
        />
        <input
          className="w-full p-3 rounded bg-slate-900 border border-slate-700"
          value={ra}
          onChange={(e) => setRa(e.target.value)}
          placeholder="RA / Matrícula"
        />
        <input
          className="w-full p-3 rounded bg-slate-900 border border-slate-700"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu.nome@faculdade.edu.br"
        />
        <button
          type="submit"
          className="w-full py-3 rounded bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400"
        >
          Entrar Instantaneamente →
        </button>
      </form>
    </main>
  );
}
