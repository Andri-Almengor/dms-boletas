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
import MaintenanceDetailPage from '../pages/maintenance/MaintenanceDetailPage';
import MaintenanceFormPage from '../pages/maintenance/MaintenanceFormPage';
import MaintenanceListPage from '../pages/maintenance/MaintenanceListPage';
import OfflineContentPage from '../pages/offline/OfflineContentPage';
import PublicSurveyPage from '../pages/surveys/PublicSurveyPage';
import SurveyDetailPage from '../pages/surveys/SurveyDetailPage';
import SurveysAdminPage from '../pages/surveys/SurveysAdminPage';
import TicketDetailPage from '../pages/tickets/TicketDetailPage';
import TicketFormPage from '../pages/tickets/TicketFormPage';
import TicketListPage from '../pages/tickets/TicketListPage';
import UserDetailPage from '../pages/users/UserDetailPage';
import UserFormPage from '../pages/users/UserFormPage';
import UsersPage from '../pages/users/UsersPage';
import OfflineEntityPermissionScope from '../routes/OfflineEntityPermissionScope';
import OfflineOwnedEditRoute from '../routes/OfflineOwnedEditRoute';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

const MAINTENANCE_VIEW = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER'];
const MAINTENANCE_CREATE = ['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR'];
const KNOWLEDGE_CREATE = ['CONOCIMIENTO_CREAR','CONOCIMIENTO_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/encuesta/:token" element={<PublicSurveyPage />} />
    <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
      <Route index element={<HomePage />} />
      <Route path="boletas/pendientes" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="PENDIENTE" /></PermissionRoute>} />
      <Route path="boletas/finalizadas" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="FINALIZADA" /></PermissionRoute>} />
      <Route path="boletas/nueva" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketFormPage mode="create" /></PermissionRoute>} />
      <Route path="boletas/:boletaUid" element={<PermissionRoute permission="BOLETAS_VER"><OfflineEntityPermissionScope type="ticket"><TicketDetailPage /></OfflineEntityPermissionScope></PermissionRoute>} />
      <Route path="boletas/:boletaUid/editar" element={<OfflineOwnedEditRoute type="ticket"><TicketFormPage mode="edit" /></OfflineOwnedEditRoute>} />
      <Route path="mantenimientos" element={<PermissionRoute anyOf={MAINTENANCE_VIEW}><MaintenanceListPage /></PermissionRoute>} />
      <Route path="mantenimientos/nuevo" element={<PermissionRoute anyOf={MAINTENANCE_CREATE}><MaintenanceFormPage mode="create" /></PermissionRoute>} />
      <Route path="mantenimientos/:maintenanceId" element={<PermissionRoute anyOf={MAINTENANCE_VIEW}><OfflineEntityPermissionScope type="maintenance"><MaintenanceDetailPage /></OfflineEntityPermissionScope></PermissionRoute>} />
      <Route path="mantenimientos/:maintenanceId/editar" element={<OfflineOwnedEditRoute type="maintenance"><MaintenanceFormPage mode="edit" /></OfflineOwnedEditRoute>} />
      <Route path="conocimiento" element={<KnowledgeListPage />} />
      <Route path="conocimiento/nuevo" element={<PermissionRoute anyOf={KNOWLEDGE_CREATE}><KnowledgeEditorPage mode="create" /></PermissionRoute>} />
      <Route path="conocimiento/categorias" element={<PermissionRoute anyOf={['CONOCIMIENTO_CATEGORIAS_GESTIONAR','USUARIOS_GESTIONAR']}><KnowledgeCategoriesPage /></PermissionRoute>} />
      <Route path="conocimiento/:tutorialId" element={<KnowledgeDetailPage />} />
      <Route path="conocimiento/:tutorialId/editar" element={<KnowledgeEditorPage mode="edit" />} />
      <Route path="clientes" element={<PermissionRoute permission="CLIENTES_VER"><ClientsPage /></PermissionRoute>} />
      <Route path="catalogos" element={<PermissionRoute anyOf={['CATALOGOS_VER','CATALOGOS_GESTIONAR','USUARIOS_GESTIONAR']}><CatalogsPage /></PermissionRoute>} />
      <Route path="categorias" element={<Navigate to="/catalogos" replace />} />
      <Route path="encuestas" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><SurveysAdminPage /></PermissionRoute>} />
      <Route path="encuestas/:encuestaId" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><SurveyDetailPage /></PermissionRoute>} />
      <Route path="cambiar-contrasena" element={<ChangePasswordPage />} />
      <Route path="mas" element={<MorePage />} />
      <Route path="mas/contenido-offline" element={<OfflineContentPage />} />
      <Route path="usuarios" element={<PermissionRoute permission="USUARIOS_VER"><UsersPage /></PermissionRoute>} />
      <Route path="usuarios/nuevo" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="create" /></PermissionRoute>} />
      <Route path="usuarios/:usuarioId" element={<PermissionRoute permission="USUARIOS_VER"><UserDetailPage /></PermissionRoute>} />
      <Route path="usuarios/:usuarioId/editar" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="edit" /></PermissionRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>;
}
