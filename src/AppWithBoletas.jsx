import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import App from './App2';
import BoletasApp from './Boletas';
import { useAuth } from './AuthContext';

export default function AppWithBoletas() {
  const location = useLocation();
  const { user, hasPermission } = useAuth();

  if (location.pathname.startsWith('/boletas')) {
    return <BoletasApp />;
  }

  return (
    <>
      {user && hasPermission('BOLETAS_VER') && (
        <nav>
          <Link to="/boletas/pendientes">Boletas pendientes</Link>{' | '}
          <Link to="/boletas/finalizadas">Boletas finalizadas</Link>
          {hasPermission('BOLETAS_CREAR') && <>{' | '}<Link to="/boletas/nueva">Crear boleta</Link></>}
          <hr />
        </nav>
      )}
      <App />
    </>
  );
}
