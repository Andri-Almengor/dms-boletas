import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Loading from '../components/common/Loading';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen-center"><Loading label="Validando sesión..." /></div>;
  return user ? children : <Navigate to="/login" replace />;
}
