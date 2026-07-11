import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import MorePage from '../pages/MorePage';
import UserDetailPage from '../pages/users/UserDetailPage';
import UserFormPage from '../pages/users/UserFormPage';
import UsersPage from '../pages/users/UsersPage';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<HomePage />} />
        <Route path="cambiar-contrasena" element={<ChangePasswordPage />} />
        <Route path="mas" element={<MorePage />} />
        <Route path="usuarios" element={<PermissionRoute permission="USUARIOS_VER"><UsersPage /></PermissionRoute>} />
        <Route path="usuarios/nuevo" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="create" /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId" element={<PermissionRoute permission="USUARIOS_VER"><UserDetailPage /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId/editar" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="edit" /></PermissionRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
