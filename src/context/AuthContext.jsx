import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';

const STORAGE_KEY = 'dms_session';
const AuthContext = createContext(null);
const OPERATIONAL_CLIENT_PERMISSIONS = [
  'BOLETAS_CREAR',
  'BOLETAS_EDITAR',
  'MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR',
  'MANTENIMIENTOS_GESTIONAR',
];

function effectivePermission(permissions, code) {
  if (!code) return true;
  if (permissions.includes('USUARIOS_GESTIONAR')) return true;
  if (permissions.includes(code)) return true;
  if (code === 'CLIENTES_DATOS_OPERATIVOS_CREAR') {
    return OPERATIONAL_CLIENT_PERMISSIONS.some((permission) => permissions.includes(permission));
  }
  return false;
}

export function AuthProvider({ children }) {
  const [sessionToken, setSessionToken] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').sessionToken || '';
    } catch {
      return '';
    }
  });
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionToken));

  useEffect(() => {
    if (!sessionToken) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);

    apiRequest('auth.me', {}, sessionToken)
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setPermissions(data.permissions || []);
      })
      .catch(() => {
        if (!active) return;
        clearSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionToken]);

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* La sesión en memoria también se limpia. */ }
    setSessionToken('');
    setUser(null);
    setPermissions([]);
    setLoading(false);
  }

  async function login(username, password) {
    const data = await apiRequest('auth.login', { username, password });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: data.sessionToken })); } catch { /* La sesión seguirá activa mientras la pestaña permanezca abierta. */ }
    setSessionToken(data.sessionToken);
    setUser(data.user);
    setPermissions(data.permissions || []);
    return data;
  }

  async function logout() {
    try {
      if (sessionToken) await apiRequest('auth.logout', {}, sessionToken);
    } finally {
      clearSession();
    }
  }

  async function refreshMe() {
    const data = await apiRequest('auth.me', {}, sessionToken);
    setUser(data.user);
    setPermissions(data.permissions || []);
    return data;
  }

  const value = useMemo(() => ({
    sessionToken,
    user,
    permissions,
    loading,
    login,
    logout,
    refreshMe,
    clearSession,
    hasPermission: (code) => effectivePermission(permissions, code),
  }), [sessionToken, user, permissions, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return context;
}
