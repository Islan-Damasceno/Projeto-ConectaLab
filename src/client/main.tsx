import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import './index.css';
import { LoginPage } from './pages/app/LoginPage.js';
import { CatalogPage } from './pages/app/CatalogPage.js';
import { CheckoutPixPage } from './pages/app/CheckoutPixPage.js';
import { ActiveRentalPage } from './pages/app/ActiveRentalPage.js';
import { LockerSimulatorPage } from './pages/locker/LockerSimulatorPage.js';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage.js';
import { isUsingMockApi, setUseMockApi } from './lib/api.js';

function DevNavigationBanner() {
  const [useMock, setMockState] = React.useState(isUsingMockApi());

  const toggleMode = () => {
    const next = !useMock;
    setUseMockApi(next);
    setMockState(next);
    window.location.reload();
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span className="font-bold text-emerald-400">ConectaLab</span>
        <nav className="flex items-center gap-2 text-slate-300">
          <Link to="/app/login" className="hover:text-white underline">
            📱 /app (Aluno)
          </Link>
          <span>•</span>
          <Link to="/locker" className="hover:text-white underline">
            🖥️ /locker (Simulador Projetor)
          </Link>
          <span>•</span>
          <Link to="/admin" className="hover:text-white underline">
            🛠️ /admin (Backoffice)
          </Link>
        </nav>
      </div>
      <button
        onClick={toggleMode}
        className={`px-2.5 py-1 rounded font-semibold transition ${
          useMock
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}
      >
        Modo API: {useMock ? 'MOCK LOCAL (Dev 1 Autônomo)' : 'BACKEND REAL (SQLite + WS)'}
      </button>
    </header>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DevNavigationBanner />
      <Routes>
        <Route path="/" element={<Navigate to="/app/login" replace />} />
        <Route path="/app" element={<Navigate to="/app/login" replace />} />
        <Route path="/app/login" element={<LoginPage />} />
        <Route path="/app/catalog" element={<CatalogPage />} />
        <Route path="/app/checkout/:rentalId" element={<CheckoutPixPage />} />
        <Route path="/app/rental/:rentalId" element={<ActiveRentalPage />} />
        <Route path="/locker" element={<LockerSimulatorPage />} />
        <Route path="/admin" element={<AdminDashboardPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
