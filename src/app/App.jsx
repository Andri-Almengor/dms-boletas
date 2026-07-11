import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import MorePage from '../pages/MorePage';
import CategoriesPage from '../pages/admin/CategoriesPage';
import ClientsPage from '../pages/admin/ClientsPage';
import TicketDetailPage from '../pages/tickets/TicketDetailPage';
import TicketFormPage from '../pages/tickets/TicketFormPage';
import TicketListPage from '../pages/tickets/TicketListPage';
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
        <Route path="boletas/pendientes" element={<TicketListPage status="PENDIENTE" />} />
        <Route path="boletas/finalizadas" element={<TicketListPage status="FINALIZADA" />} />
        <Route path="boletas/nueva" element={<TicketFormPage mode="create" />} />
        <Route path="boletas/:boletaId" element={<TicketDetailPage />} />
        <Route path="boletas/:boletaId/editar" element={<TicketFormPage mode="edit" />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="categorias" element={<CategoriesPage />} />
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
