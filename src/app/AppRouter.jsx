import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import LoginPage from '../features/auth/LoginPage';
import HomePage from '../features/home/HomePage';
import MorePage from '../features/more/MorePage';
import AppShell from './layout/AppShell';
import LegacyApp from '../App2';
import BoletasApp from '../Boletas';
import CatalogosApp from '../Catalogos';
import './legacy-modules.css';

function Protected({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="page">
        <div className="card">Cargando...</div>
      </main>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

function resolveTitle(pathname) {
  if (pathname.startsWith('/usuarios')) return 'Usuarios';
  if (pathname.startsWith('/clientes')) return 'Clientes';
  if (pathname.startsWith('/catalogos')) return 'Catálogos';
  if (pathname === '/cambiar-contrasena') return 'Cambiar contraseña';
  if (pathname.includes('/boletas/nueva')) return 'Crear Boleta';
  if (pathname.includes('/boletas/finalizadas')) return 'Boletas Finalizadas';
  if (/^\/boletas\/[^/]+(?:\/editar)?$/.test(pathname)) return 'Detalle de Boleta';
  if (pathname.startsWith('/boletas')) return 'Boletas Pendientes';
  return 'DMS Boletas';
}

/**
 * Los módulos originales contienen sus propios <Routes>.
 * Deben montarse desde un único splat raíz para que React Router conserve
 * la base "/". Si se montan dentro de /usuarios/* o /boletas/*, sus rutas
 * internas terminan resolviéndose como /usuarios/usuarios o dejan de coincidir.
 */
function FunctionalApplication() {
  const { pathname } = useLocation();

  if (pathname === '/') return <HomePage />;
  if (pathname === '/mas') return <MorePage />;

  if (pathname.startsWith('/boletas')) {
    return (
      <AppShell title={resolveTitle(pathname)}>
        <div className="legacy-module boletas-module">
          <BoletasApp />
        </div>
      </AppShell>
    );
  }

  if (pathname.startsWith('/catalogos')) {
    return (
      <AppShell title={resolveTitle(pathname)}>
        <div className="legacy-module catalogos-module">
          <CatalogosApp />
        </div>
      </AppShell>
    );
  }

  if (
    pathname.startsWith('/usuarios') ||
    pathname.startsWith('/clientes') ||
    pathname === '/cambiar-contrasena'
  ) {
    return (
      <AppShell title={resolveTitle(pathname)}>
        <div className="legacy-module">
          <LegacyApp />
        </div>
      </AppShell>
    );
  }

  return <Navigate to="/" replace />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={(
          <Protected>
            <FunctionalApplication />
          </Protected>
        )}
      />
    </Routes>
  );
}
