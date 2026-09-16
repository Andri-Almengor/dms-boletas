import { isAuthenticationError } from '../services/requestErrors';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import { hasImpliedOperationalClientPermission } from '../config/formInlineCreationPolicy';
import { clearSyncSecurityBlock } from '../services/syncManager';

const STORAGE_KEY = 'dms_session';
const AuthContext = createContext(null);

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

function effectivePermission(permissions, code) {
  if (!code) return true;
  if (permissions.includes('USUARIOS_GESTIONAR')) return true;
  if (permissions.includes(code)) return true;
  if (code === 'CLIENTES_DATOS_OPERATIVOS_CREAR') {
    return hasImpliedOperationalClientPermission(permissions);
  }
  return false;
}

async function acceptAuthoritativeSession(sessionToken, data, setters = {}) {
  const nextPermissions = data.permissions || [];
  await clearSyncSecurityBlock(data.user?.UsuarioID, nextPermissions).catch(() => {});
  setters.setUser?.(data.user);
  setters.setPermissions?.(nextPermissions);
  saveStoredSession(sessionToken, data.user, nextPermissions);
  return nextPermissions;
}

export function AuthProvider({ children }) {
  const initial = useMemo(() => readStoredSession(), []);
  const [sessionToken, setSessionToken] = useState(initial.sessionToken);
  const [user, setUser] = useState(initial.user);
  const [permissions, setPermissions] = useState(initial.permissions);
  const [loading, setLoading] = useState(Boolean(initial.sessionToken && !initial.user));
  const [securityRevision, setSecurityRevision] = useState(0);

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* La sesión en memoria también se limpia. */ }
    setSessionToken('');
    setUser(null);
    setPermissions([]);
    setSecurityRevision((current) => current + 1);
    setLoading(false);
  }

  useEffect(() => {
    if (!sessionToken) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(!user);

    apiRequest('auth.me', {}, sessionToken, { signal: controller.signal })
      .then(async (data) => {
        if (!active) return;
        await acceptAuthoritativeSession(sessionToken, data, { setUser, setPermissions });
        if (active) setSecurityRevision((current) => current + 1);
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
      controller.abort();
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken || typeof window === 'undefined') return undefined;
    let active = true;
    let controller = null;
    const onSecurityInvalidated = () => {
      controller?.abort();
      controller = new AbortController();
      apiRequest('auth.me', {}, sessionToken, { signal: controller.signal })
        .then(async (data) => {
          if (!active) return;
          await acceptAuthoritativeSession(sessionToken, data, { setUser, setPermissions });
          if (active) setSecurityRevision((current) => current + 1);
        })
        .catch((error) => {
          if (!active) return;
          if (isAuthenticationError(error)) clearSession();
        });
    };
    window.addEventListener('dms-sync-security-invalidated', onSecurityInvalidated);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('dms-sync-security-invalidated', onSecurityInvalidated);
    };
  }, [sessionToken]);

  async function login(username, password) {
    const data = await apiRequest('auth.login', { username, password });
    const nextPermissions = await acceptAuthoritativeSession(data.sessionToken, data, { setUser, setPermissions });
    setSessionToken(data.sessionToken);
    setSecurityRevision((current) => current + 1);
    return { ...data, permissions: nextPermissions };
  }

  async function logout() {
    try {
      if (sessionToken && navigator.onLine !== false) await apiRequest('auth.logout', {}, sessionToken);
    } finally {
      clearSession();
    }
  }

  async function refreshMe() {
    const data = await apiRequest('auth.me', {}, sessionToken).catch((error) => {
      if (isAuthenticationError(error)) clearSession();
      throw error;
    });
    const nextPermissions = await acceptAuthoritativeSession(sessionToken, data, { setUser, setPermissions });
    setSecurityRevision((current) => current + 1);
    return { ...data, permissions: nextPermissions };
  }

  const value = useMemo(() => ({
    sessionToken,
    user,
    permissions,
    loading,
    securityRevision,
    login,
    logout,
    refreshMe,
    clearSession,
    hasPermission: (code) => effectivePermission(permissions, code),
  }), [sessionToken, user, permissions, loading, securityRevision]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return context;
}
