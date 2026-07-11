import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function PermissionRoute({ permission, children }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : <Navigate to="/" replace />;
}
