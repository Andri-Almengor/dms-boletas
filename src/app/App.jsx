import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import MorePage from '../pages/MorePage';
import CatalogsPage from '../pages/admin/CatalogsPage';
import ClientsPage from '../pages/admin/ClientsPage';
import KnowledgeCategoriesPage from '../pages/knowledge/KnowledgeCategoriesPage';
import KnowledgeDetailPage from '../pages/knowledge/KnowledgeDetailPage';
import KnowledgeEditorPage from '../pages/knowledge/KnowledgeEditorPage';
import KnowledgeListPage from '../pages/knowledge/KnowledgeListPage';
import TicketDetailPage from '../pages/tickets/TicketDetailPage';
import TicketFormPage from '../pages/tickets/TicketFormPage';
import TicketListPage from '../pages/tickets/TicketListPage';
import UserDetailPage from '../pages/users/UserDetailPage';
import UserFormPage from '../pages/users/UserFormPage';
import UsersPage from '../pages/users/UsersPage';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
      <Route index element={<HomePage />} />
      <Route path="boletas/pendientes" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="PENDIENTE" /></PermissionRoute>} />
      <Route path="boletas/finalizadas" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="FINALIZADA" /></PermissionRoute>} />
      <Route path="boletas/nueva" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketFormPage mode="create" /></PermissionRoute>} />
      <Route path="boletas/:boletaUid" element={<PermissionRoute permission="BOLETAS_VER"><TicketDetailPage /></PermissionRoute>} />
      <Route path="boletas/:boletaUid/editar" element={<PermissionRoute permission="BOLETAS_EDITAR"><TicketFormPage mode="edit" /></PermissionRoute>} />
      <Route path="conocimiento" element={<KnowledgeListPage />} />
      <Route path="conocimiento/nuevo" element={<KnowledgeEditorPage mode="create" />} />
      <Route path="conocimiento/categorias" element={<KnowledgeCategoriesPage />} />
      <Route path="conocimiento/:tutorialId" element={<KnowledgeDetailPage />} />
      <Route path="conocimiento/:tutorialId/editar" element={<KnowledgeEditorPage mode="edit" />} />
      <Route path="clientes" element={<PermissionRoute permission="CLIENTES_VER"><ClientsPage /></PermissionRoute>} />
      <Route path="catalogos" element={<CatalogsPage />} />
      <Route path="categorias" element={<Navigate to="/catalogos" replace />} />
      <Route path="cambiar-contrasena" element={<ChangePasswordPage />} />
      <Route path="mas" element={<MorePage />} />
      <Route path="usuarios" element={<PermissionRoute permission="USUARIOS_VER"><UsersPage /></PermissionRoute>} />
      <Route path="usuarios/nuevo" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="create" /></PermissionRoute>} />
      <Route path="usuarios/:usuarioId" element={<PermissionRoute permission="USUARIOS_VER"><UserDetailPage /></PermissionRoute>} />
      <Route path="usuarios/:usuarioId/editar" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="edit" /></PermissionRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>;
}
