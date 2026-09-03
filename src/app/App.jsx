import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import Icon from '../components/common/Icon';
import useOfflineMode from '../hooks/useOfflineMode';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';
import {
  loadAgendaPage,
  loadAssistantPage,
  loadCatalogsPage,
  loadChangePasswordPage,
  loadClientsPage,
  loadCustomerCaseDetailPage,
  loadCustomerCasesPage,
  loadHomePage,
  loadKnowledgeCategoriesPage,
  loadKnowledgeDetailPage,
  loadKnowledgeEditorPage,
  loadKnowledgeListPage,
  loadLegacyTicketsImportPage,
  loadLoginPage,
  loadMaintenanceDetailPage,
  loadMaintenanceFormPage,
  loadMaintenanceListPage,
  loadMaintenanceQuestionsPage,
  loadMetricsPage,
  loadMorePage,
  loadNotificationSettingsPage,
  loadOfflineContentPage,
  loadPasswordVaultPage,
  loadPublicCustomerCasePage,
  loadPublicSignaturePage,
  loadPublicSurveyPage,
  loadSurveyDetailPage,
  loadSurveysAdminPage,
  loadTicketDetailWithQuickEdit,
  loadTicketFormPage,
  loadTicketListPage,
  loadTicketQuickEditPage,
  loadTicketRelatedVisitPage,
  loadUserDetailPage,
  loadUserFormPage,
  loadUsersPage,
} from './routeLoaders';

const FormRecoveryManager = lazy(() => import('../components/offline/FormRecoveryManager'));
const MaintenanceFinalizationCenter = lazy(() => import('../components/offline/MaintenanceFinalizationCenter'));
const ClientCatalogSyncBridge = lazy(() => import('../components/system/ClientCatalogSyncBridge'));
const MobileTimePickerBridge = lazy(() => import('../components/forms/MobileTimePickerBridge'));
const TicketHoursCeilingBridge = lazy(() => import('../components/forms/TicketHoursCeilingBridge'));
const TicketEvidenceMultiSelectBridge = lazy(() => import('../components/forms/TicketEvidenceMultiSelectBridge'));
const ActionProcessingBridge = lazy(() => import('../components/feedback/ActionProcessingBridge'));
const OperationalDeleteBridge = lazy(() => import('../components/operational/OperationalDeleteBridge'));

const ChangePasswordPage = lazy(loadChangePasswordPage);
const HomePage = lazy(loadHomePage);
const LoginPage = lazy(loadLoginPage);
const MorePage = lazy(loadMorePage);
const AgendaPage = lazy(loadAgendaPage);
const CatalogsPage = lazy(loadCatalogsPage);
const ClientsPage = lazy(loadClientsPage);
const LegacyTicketsImportPage = lazy(loadLegacyTicketsImportPage);
const MaintenanceQuestionsPage = lazy(loadMaintenanceQuestionsPage);
const MetricsPage = lazy(loadMetricsPage);
const NotificationSettingsPage = lazy(loadNotificationSettingsPage);
const AssistantPage = lazy(loadAssistantPage);
const CustomerCasesPage = lazy(loadCustomerCasesPage);
const CustomerCaseDetailPage = lazy(loadCustomerCaseDetailPage);
const PublicCustomerCasePage = lazy(loadPublicCustomerCasePage);
const KnowledgeCategoriesPage = lazy(loadKnowledgeCategoriesPage);
const KnowledgeDetailPage = lazy(loadKnowledgeDetailPage);
const KnowledgeEditorPage = lazy(loadKnowledgeEditorPage);
const KnowledgeListPage = lazy(loadKnowledgeListPage);
const MaintenanceDetailPage = lazy(loadMaintenanceDetailPage);
const MaintenanceFormPage = lazy(loadMaintenanceFormPage);
const MaintenanceListPage = lazy(loadMaintenanceListPage);
const OfflineContentPage = lazy(loadOfflineContentPage);
const PasswordVaultPage = lazy(loadPasswordVaultPage);
const PublicSurveyPage = lazy(loadPublicSurveyPage);
const SurveyDetailPage = lazy(loadSurveyDetailPage);
const SurveysAdminPage = lazy(loadSurveysAdminPage);
const PublicSignaturePage = lazy(loadPublicSignaturePage);
const TicketDetailWithQuickEdit = lazy(loadTicketDetailWithQuickEdit);
const TicketFormPage = lazy(loadTicketFormPage);
const TicketListPage = lazy(loadTicketListPage);
const TicketQuickEditPage = lazy(loadTicketQuickEditPage);
const TicketRelatedVisitPage = lazy(loadTicketRelatedVisitPage);
const UserDetailPage = lazy(loadUserDetailPage);
const UserFormPage = lazy(loadUserFormPage);
const UsersPage = lazy(loadUsersPage);

const MAINTENANCE_VIEW = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER','USUARIOS_GESTIONAR'];
const MAINTENANCE_CREATE = ['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const MAINTENANCE_EDIT = ['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR','USUARIOS_GESTIONAR'];
const KNOWLEDGE_CREATE = ['CONOCIMIENTO_CREAR','CONOCIMIENTO_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const CATALOG_VIEW = ['CATALOGOS_VER','CATALOGOS_GESTIONAR','USUARIOS_GESTIONAR'];
const PASSWORD_VAULT_VIEW = ['CLIENTES_VER','BOLETAS_VER','MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','USUARIOS_GESTIONAR'];

function RouteLoading() {
  return <div className="state-card state-card--loading app-route-loading" role="status"><Icon name="progress_activity" /><span>Abriendo módulo...</span></div>;
}

function isTicketWorkflow(pathname) {
  return pathname === '/boletas/nueva'
    || /^\/boletas\/[^/]+\/editar$/.test(pathname)
    || /^\/boletas\/[^/]+\/editar-rapido\/[^/]+$/.test(pathname)
    || /^\/boletas\/[^/]+\/nueva-visita$/.test(pathname);
}

function isMaintenanceWorkflow(pathname) {
  return pathname === '/mantenimientos/nuevo'
    || /^\/mantenimientos\/[^/]+\/editar$/.test(pathname);
}

function isTicketDetail(pathname) {
  const match = pathname.match(/^\/boletas\/([^/]+)\/?$/);
  if (!match) return false;
  return !['pendientes', 'finalizadas', 'nueva'].includes(String(match[1] || '').toLowerCase());
}

function RouteScopedBridges() {
  const { pathname } = useLocation();
  const ticketWorkflow = isTicketWorkflow(pathname);
  const timePickerNeeded = ticketWorkflow || isMaintenanceWorkflow(pathname);
  const evidenceBridgeNeeded = isTicketDetail(pathname);

  if (!timePickerNeeded && !ticketWorkflow && !evidenceBridgeNeeded) return null;
  return <Suspense fallback={null}>
    {timePickerNeeded && <MobileTimePickerBridge />}
    {ticketWorkflow && <TicketHoursCeilingBridge />}
    {evidenceBridgeNeeded && <TicketEvidenceMultiSelectBridge />}
  </Suspense>;
}

function FormRecoveryRuntime() {
  return <Suspense fallback={null}><FormRecoveryManager /></Suspense>;
}

function MaintenanceFinalizationRuntime() {
  return <Suspense fallback={null}><MaintenanceFinalizationCenter /></Suspense>;
}

function OptionalOfflineRuntime() {
  const [offlineEnabled] = useOfflineMode();

  useEffect(() => {
    if (offlineEnabled) import('../services/ticketVisitOfflineSync');
  }, [offlineEnabled]);

  if (!offlineEnabled) return null;
  return <Suspense fallback={null}>
    <ClientCatalogSyncBridge />
  </Suspense>;
}

export default function App() {
  return <>
    <FormRecoveryRuntime />
    <MaintenanceFinalizationRuntime />
    <OptionalOfflineRuntime />
    <Suspense fallback={null}><ActionProcessingBridge /></Suspense>
    <Suspense fallback={null}><OperationalDeleteBridge /></Suspense>
    <RouteScopedBridges />
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/caso/:token" element={<PublicCustomerCasePage />} />
        <Route path="/encuesta/:token" element={<PublicSurveyPage />} />
        <Route path="/firmar/:token" element={<PublicSignaturePage />} />
        <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route index element={<HomePage />} />
          <Route path="asistente" element={<AssistantPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="boletas/pendientes" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="PENDIENTE" /></PermissionRoute>} />
          <Route path="boletas/finalizadas" element={<PermissionRoute permission="BOLETAS_VER"><TicketListPage status="FINALIZADA" /></PermissionRoute>} />
          <Route path="boletas/nueva" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketFormPage mode="create" /></PermissionRoute>} />
          <Route path="boletas/:boletaUid" element={<PermissionRoute permission="BOLETAS_VER"><TicketDetailWithQuickEdit /></PermissionRoute>} />
          <Route path="boletas/:boletaUid/nueva-visita" element={<PermissionRoute permission="BOLETAS_CREAR"><TicketRelatedVisitPage /></PermissionRoute>} />
          <Route path="boletas/:boletaUid/editar" element={<PermissionRoute permission="BOLETAS_EDITAR"><TicketFormPage mode="edit" /></PermissionRoute>} />
          <Route path="boletas/:boletaUid/editar-rapido/:section" element={<PermissionRoute permission="BOLETAS_EDITAR"><TicketQuickEditPage /></PermissionRoute>} />
          <Route path="casos" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><CustomerCasesPage /></PermissionRoute>} />
          <Route path="casos/:caseId" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><CustomerCaseDetailPage /></PermissionRoute>} />
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
          <Route path="credenciales" element={<PermissionRoute anyOf={PASSWORD_VAULT_VIEW}><PasswordVaultPage /></PermissionRoute>} />
          <Route path="catalogos" element={<PermissionRoute anyOf={CATALOG_VIEW}><CatalogsPage /></PermissionRoute>} />
          <Route path="catalogos/preguntas-mantenimiento" element={<PermissionRoute anyOf={CATALOG_VIEW}><MaintenanceQuestionsPage /></PermissionRoute>} />
          <Route path="categorias" element={<Navigate to="/catalogos" replace />} />
          <Route path="metricas" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><MetricsPage /></PermissionRoute>} />
          <Route path="dashboard" element={<Navigate to="/metricas" replace />} />
          <Route path="administracion/notificaciones" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><NotificationSettingsPage /></PermissionRoute>} />
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
