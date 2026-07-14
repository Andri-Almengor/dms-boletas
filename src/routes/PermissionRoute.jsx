import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

function values(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export default function PermissionRoute({ permission, anyOf, allOf, children, fallback = '/' }) {
  const { hasPermission } = useAuth();
  const any = [...values(permission), ...values(anyOf)];
  const all = values(allOf);
  const allowedAny = !any.length || any.some((code) => hasPermission(code));
  const allowedAll = all.every((code) => hasPermission(code));
  return allowedAny && allowedAll ? children : <Navigate to={fallback} replace />;
}
