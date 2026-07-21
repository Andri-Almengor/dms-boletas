import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import FormRecoveryManager from '../components/offline/FormRecoveryManager';
import ChangePasswordPage from '../pages/ChangePasswordPage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import MorePage from '../pages/MorePage';
import CatalogsPage from '../pages/admin/CatalogsPage';
import ClientsPage from '../pages/admin/ClientsPage';
import LegacyTicketsImportPage from '../pages/admin/LegacyTicketsImportPage';
import MetricsPage from '../pages/admin/MetricsPage';
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
import PublicSignaturePage from '../pages/tickets/PublicSignaturePage';
import TicketDetailWithQuickEdit from '../pages/tickets/TicketDetailWithQuickEdit';
import TicketFormPage from '../pages/tickets/TicketFormPage';
import TicketListPage from '../pages/tickets/TicketListPage';
import TicketQuickEditPage from '../pages/tickets/TicketQuickEditPage';
import TicketRelatedVisitPage from '../pages/tickets/TicketRelatedVisitPage';
import UserDetailPage from '../pages/users/UserDetailPage';
import UserFormPage from '../pages/users/UserFormPage';
import UsersPage from '../pages/users/UsersPage';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

const MAINTENANCE_VIEW = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER'];
const MAINTENANCE_CREATE = ['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR'];
const MAINTENANCE_EDIT = ['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR'];
const KNOWLEDGE_CREATE = ['CONOCIMIENTO_CREAR','CONOCIMIENTO_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];

export default function App() {
  return <>
    <FormRecoveryManager />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/encuesta/:token" element={<PublicSurveyPage />} />
      <Route path="/firmar/:token" element={<PublicSignaturePage />} />
      <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<HomePage />} />
        <Route path="boletas/pendientes" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="PENDIENTE" /></PermissionRoute>} />
        <Route path="boletas/finalizadas" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="FINALIZADA" /></PermissionRoute>} />
        <Route path="boletas/nueva" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketFormPage mode="create" /></PermissionRoute>} />
        <Route path="boletas/:boletaUid" element={<PermissionRoute permission="BOLETAS_VER"><TicketDetailWithQuickEdit /></PermissionRoute>} />
        <Route path="boletas/:boletaUid/nueva-visita" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketRelatedVisitPage /></PermissionRoute>} />
        <Route path="boletas/:boletaUid/editar" element={<PermissionRoute permission="BOLETAS_EDITAR"><TicketFormPage mode="edit" /></PermissionRoute>} />
        <Route path="boletas/:boletaUid/editar-rapido/:section" element={<PermissionRoute permission="BOLETAS_EDITAR"><TicketQuickEditPage /></PermissionRoute>} />
        <Route path="mantenimientos" element={<PermissionRoute anyOf={MAINTENANCE_VIEW}><MaintenanceListPage /></PermissionRoute>} />
        <Route path="mantenimientos/nuevo" element={<PermissionRoute anyOf={MAINTENANCE_CREATE}><MaintenanceFormPage mode="create" /></PermissionRoute>} />
        <Route path="mantenimientos/:maintenanceId" element={<PermissionRoute anyOf={MAINTENANCE_VIEW}><MaintenanceDetailPage /></PermissionRoute>} />
        <Route path="mantenimientos/:maintenanceId/editar" element={<PermissionRoute anyOf={MAINTENANCE_EDIT}><MaintenanceFormPage mode="edit" /></PermissionRoute>} />
        <Route path="conocimiento" element={<KnowledgeListPage />} />
        <Route path="conocimiento/nuevo" element={<PermissionRoute anyOf={KNOWLEDGE_CREATE}><KnowledgeEditorPage mode="create" /></PermissionRoute>} />
        <Route path="conocimiento/categorias" element={<PermissionRoute anyOf={['CONOCIMIENTO_CATEGORIAS_GESTIONAR','USUARIOS_GESTIONAR']}><KnowledgeCategoriesPage /></PermissionRoute>} />
        <Route path="conocimiento/:tutorialId" element={<KnowledgeDetailPage />} />
        <Route path="conocimiento/:tutorialId/editar" element={<KnowledgeEditorPage mode="edit" />} />
        <Route path="clientes" element={<PermissionRoute permission="CLIENTES_VER"><ClientsPage /></PermissionRoute>} />
        <Route path="catalogos" element={<PermissionRoute anyOf={['CATALOGOS_VER','CATALOGOS_GESTIONAR','USUARIOS_GESTIONAR']}><CatalogsPage /></PermissionRoute>} />
        <Route path="categorias" element={<Navigate to="/catalogos" replace />} />
        <Route path="metricas" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><MetricsPage /></PermissionRoute>} />
        <Route path="dashboard" element={<Navigate to="/metricas" replace />} />
        <Route path="administracion/importar-boletas" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><LegacyTicketsImportPage /></PermissionRoute>} />
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
    </Routes>
  </>;
}
