import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import App from './App2';
import BoletasApp from './BoletasEnhanced';
import CatalogosApp from './Catalogos';
import { useAuth } from './AuthContext';

export default function AppWithBoletas() {
  const location = useLocation();
  const { user, hasPermission } = useAuth();

  if (location.pathname.startsWith('/boletas')) {
    return <BoletasApp />;
  }

  if (location.pathname.startsWith('/catalogos')) {
    return <CatalogosApp />;
  }

  return (
    <>
      {user && (
        <nav>
          {hasPermission('BOLETAS_VER') && (
            <>
              <Link to="/boletas/pendientes">Boletas pendientes</Link>{' | '}
              <Link to="/boletas/finalizadas">Boletas finalizadas</Link>
              {hasPermission('BOLETAS_CREAR') && <>{' | '}<Link to="/boletas/nueva">Crear boleta</Link></>}
            </>
          )}
          {hasPermission('CATALOGOS_GESTIONAR') && (
            <>{hasPermission('BOLETAS_VER') && ' | '}<Link to="/catalogos">Administrar catálogos</Link></>
          )}
          <hr />
        </nav>
      )}
      <App />
    </>
  );
}
