import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';

const STORAGE_KEY = 'dms_session';
const AuthContext = createContext(null);

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
      return;
    }

    apiRequest('auth.me', {}, sessionToken)
      .then((data) => {
        setUser(data.user);
        setPermissions(data.permissions || []);
      })
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, [sessionToken]);

  function persistSession(token) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: token }));
    setSessionToken(token);
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    setSessionToken('');
    setUser(null);
    setPermissions([]);
  }

  async function login(username, password) {
    const data = await apiRequest('auth.login', { username, password });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: data.sessionToken }));
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
    hasPermission: (code) => permissions.includes(code),
  }), [sessionToken, user, permissions, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return context;
}
