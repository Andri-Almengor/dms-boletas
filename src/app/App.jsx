import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import Icon from '../components/common/Icon';
import useOfflineMode from '../hooks/useOfflineMode';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

const FormRecoveryManager = lazy(() => import('../components/offline/FormRecoveryManager'));
const FormRecoveryMobileController = lazy(() => import('../components/offline/FormRecoveryMobileController'));
const ChangePasswordPage = lazy(() => import('../pages/ChangePasswordPage'));
const HomePage = lazy(() => import('../pages/HomePage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const MorePage = lazy(() => import('../pages/MorePage'));
const CatalogsPage = lazy(() => import('../pages/admin/CatalogsPage'));
const ClientsPage = lazy(() => import('../pages/admin/ClientsPage'));
const LegacyTicketsImportPage = lazy(() => import('../pages/admin/LegacyTicketsImportPage'));
const MaintenanceQuestionsPage = lazy(() => import('../pages/admin/MaintenanceQuestionsPage'));
const MetricsPage = lazy(() => import('../pages/admin/MetricsPage'));
const AssistantPage = lazy(() => import('../pages/assistant/AssistantPage'));
const KnowledgeCategoriesPage = lazy(() => import('../pages/knowledge/KnowledgeCategoriesPage'));
const KnowledgeDetailPage = lazy(() => import('../pages/knowledge/KnowledgeDetailPage'));
const KnowledgeEditorPage = lazy(() => import('../pages/knowledge/KnowledgeEditorPage'));
const KnowledgeListPage = lazy(() => import('../pages/knowledge/KnowledgeListPage'));
const MaintenanceDetailPage = lazy(() => import('../pages/maintenance/MaintenanceDetailPage'));
const MaintenanceFormPage = lazy(() => import('../pages/maintenance/MaintenanceFormPage'));
const MaintenanceListPage = lazy(() => import('../pages/maintenance/MaintenanceListPage'));
const OfflineContentPage = lazy(() => import('../pages/offline/OfflineContentPage'));
const PublicSurveyPage = lazy(() => import('../pages/surveys/PublicSurveyPage'));
const SurveyDetailPage = lazy(() => import('../pages/surveys/SurveyDetailPage'));
const SurveysAdminPage = lazy(() => import('../pages/surveys/SurveysAdminPage'));
const PublicSignaturePage = lazy(() => import('../pages/tickets/PublicSignaturePage'));
const TicketDetailWithQuickEdit = lazy(() => import('../pages/tickets/TicketDetailWithQuickEdit'));
const TicketFormPage = lazy(() => import('../pages/tickets/TicketFormPage'));
const TicketListPage = lazy(() => import('../pages/tickets/TicketListPage'));
const TicketQuickEditPage = lazy(() => import('../pages/tickets/TicketQuickEditPage'));
const TicketRelatedVisitPage = lazy(() => import('../pages/tickets/TicketRelatedVisitPage'));
const UserDetailPage = lazy(() => import('../pages/users/UserDetailPage'));
const UserFormPage = lazy(() => import('../pages/users/UserFormPage'));
const UsersPage = lazy(() => import('../pages/users/UsersPage'));

const MAINTENANCE_VIEW = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER','USUARIOS_GESTIONAR'];
const MAINTENANCE_CREATE = ['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const MAINTENANCE_EDIT = ['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR','USUARIOS_GESTIONAR'];
const KNOWLEDGE_CREATE = ['CONOCIMIENTO_CREAR','CONOCIMIENTO_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const CATALOG_VIEW = ['CATALOGOS_VER','CATALOGOS_GESTIONAR','USUARIOS_GESTIONAR'];

function RouteLoading() {
  return <div className="state-card state-card--loading app-route-loading" role="status"><Icon name="progress_activity" /><span>Abriendo módulo...</span></div>;
}

function OptionalOfflineRuntime() {
  const [offlineEnabled] = useOfflineMode();

  useEffect(() => {
    if (offlineEnabled) import('../services/ticketVisitOfflineSync');
  }, [offlineEnabled]);

  if (!offlineEnabled) return null;
  return <Suspense fallback={null}><FormRecoveryManager /><FormRecoveryMobileController /></Suspense>;
}

export default function App() {
  return <>
    <OptionalOfflineRuntime />
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/encuesta/:token" element={<PublicSurveyPage />} />
        <Route path="/firmar/:token" element={<PublicSignaturePage />} />
        <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route index element={<HomePage />} />
          <Route path="asistente" element={<AssistantPage />} />
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
          <Route path="catalogos" element={<PermissionRoute anyOf={CATALOG_VIEW}><CatalogsPage /></PermissionRoute>} />
          <Route path="catalogos/preguntas-mantenimiento" element={<PermissionRoute anyOf={CATALOG_VIEW}><MaintenanceQuestionsPage /></PermissionRoute>} />
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
    </Suspense>
  </>;
}
