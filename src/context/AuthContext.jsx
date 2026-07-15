import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';

const STORAGE_KEY = 'dms_session';
export const AuthContext = createContext(null);
const OPERATIONAL_CLIENT_PERMISSIONS = [
  'BOLETAS_CREAR',
  'BOLETAS_EDITAR',
  'MANTENIMIENTOS_CREAR',
  'MANTENIMIENTOS_EDITAR',
  'MANTENIMIENTOS_GESTIONAR',
];

function readStoredSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      sessionToken: stored.sessionToken || '',
      user: stored.user || null,
      permissions: Array.isArray(stored.permissions) ? stored.permissions : [],
    };
  } catch {
    return { sessionToken: '', user: null, permissions: [] };
  }
}

function saveStoredSession(sessionToken, user, permissions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessionToken,
      user: user || null,
      permissions: Array.isArray(permissions) ? permissions : [],
      savedAt: Date.now(),
    }));
  } catch {
    // La sesión seguirá activa en memoria aunque el navegador bloquee el almacenamiento.
  }
}

function isAuthenticationError(error) {
  return Number(error?.status || 0) === 401
    || String(error?.code || '').toUpperCase() === 'UNAUTHORIZED';
}

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
  const initial = useMemo(() => readStoredSession(), []);
  const [sessionToken, setSessionToken] = useState(initial.sessionToken);
  const [user, setUser] = useState(initial.user);
  const [permissions, setPermissions] = useState(initial.permissions);
  const [loading, setLoading] = useState(Boolean(initial.sessionToken && !initial.user));

  useEffect(() => {
    if (!sessionToken) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(!user);

    apiRequest('auth.me', {}, sessionToken)
      .then((data) => {
        if (!active) return;
        const nextPermissions = data.permissions || [];
        setUser(data.user);
        setPermissions(nextPermissions);
        saveStoredSession(sessionToken, data.user, nextPermissions);
      })
      .catch((error) => {
        if (!active) return;
        if (isAuthenticationError(error)) {
          clearSession();
          return;
        }
        // Una caída de red o del servidor no debe cerrar la sesión ni borrar los
        // permisos ya descargados. La aplicación puede continuar en modo offline.
        if (!user) {
          const cached = readStoredSession();
          setUser(cached.user);
          setPermissions(cached.permissions);
        }
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
    const nextPermissions = data.permissions || [];
    saveStoredSession(data.sessionToken, data.user, nextPermissions);
    setSessionToken(data.sessionToken);
    setUser(data.user);
    setPermissions(nextPermissions);
    return data;
  }

  async function logout() {
    try {
      if (sessionToken && navigator.onLine !== false) await apiRequest('auth.logout', {}, sessionToken);
    } finally {
      clearSession();
    }
  }

  async function refreshMe() {
    const data = await apiRequest('auth.me', {}, sessionToken);
    const nextPermissions = data.permissions || [];
    setUser(data.user);
    setPermissions(nextPermissions);
    saveStoredSession(sessionToken, data.user, nextPermissions);
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
