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
    <header className="flex h-10 items-center justify-between gap-3 overflow-x-auto whitespace-nowrap bg-conecta-deep px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-conecta-cream/70">
      <nav className="flex items-center gap-4">
        <span className="text-conecta-lime">Dev</span>
        <Link to="/app/login" className="hover:text-conecta-cream">App</Link>
        <Link to="/locker" className="hover:text-conecta-cream">Armário</Link>
        <Link to="/admin" className="hover:text-conecta-cream">Admin</Link>
      </nav>
      <button onClick={toggleMode} className={useMock ? 'text-amber-300' : 'text-conecta-lime'}>
        {useMock ? 'Mock local' : 'Backend real'}
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
