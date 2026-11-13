import { useNavigate } from 'react-router-dom';
import { getSessionUser, logout } from '../lib/api.js';
import { LogoMark, Wordmark } from './Logo.js';

/**
 * Cabeçalho das telas do aluno (depois do login):
 * logo + nome à esquerda, saudação e "Sair" à direita, em letras pequenas.
 */
export function AppHeader() {
  const navigate = useNavigate();
  const user = getSessionUser();
  const firstName = user?.name.split(' ')[0];

  const handleLogout = () => {
    logout();
    navigate('/app/login');
  };

  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <LogoMark size={30} />
        <Wordmark className="text-lg" />
      </div>
      <div className="flex items-center gap-4">
        {firstName && <span className="label-caps text-conecta-cream/70">Olá, {firstName}</span>}
        <button onClick={handleLogout} className="label-caps text-conecta-lime">
          Sair
        </button>
      </div>
    </header>
  );
}
