import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import Icon from '../components/common/Icon';
import useOfflineMode from '../hooks/useOfflineMode';
import PermissionRoute from '../routes/PermissionRoute';
import ProtectedRoute from '../routes/ProtectedRoute';

const routeStyles = {
  home: () => import('../styles/routes/home.js'),
  login: () => import('../styles/routes/login.js'),
  tickets: () => import('../styles/routes/tickets.js'),
  maintenance: () => import('../styles/routes/maintenance.js'),
  knowledge: () => import('../styles/routes/knowledge.js'),
  assistant: () => import('../styles/routes/assistant.js'),
  clients: () => import('../styles/routes/clients.js'),
  admin: () => import('../styles/routes/admin.js'),
  metrics: () => import('../styles/routes/metrics.js'),
  surveys: () => import('../styles/routes/surveys.js'),
  more: () => import('../styles/routes/more.js'),
  offline: () => import('../styles/routes/offline.js'),
  legacy: () => import('../styles/routes/legacy.js'),
};

function lazyPage(loadPage, ...loadAssets) {
  return lazy(async () => {
    const [page] = await Promise.all([loadPage(), ...loadAssets.map((load) => load())]);
    return page;
  });
}

const FormRecoveryManager = lazy(() => import('../components/offline/FormRecoveryManager'));
const MaintenanceFinalizationCenter = lazy(() => import('../components/offline/MaintenanceFinalizationCenter'));
const ClientCatalogSyncBridge = lazy(() => import('../components/system/ClientCatalogSyncBridge'));
const MobileTimePickerBridge = lazy(() => import('../components/forms/MobileTimePickerBridge'));
const TicketHoursCeilingBridge = lazy(() => import('../components/forms/TicketHoursCeilingBridge'));
const TicketEvidenceMultiSelectBridge = lazy(() => import('../components/forms/TicketEvidenceMultiSelectBridge'));
const ActionProcessingBridge = lazy(() => import('../components/feedback/ActionProcessingBridge'));

const ChangePasswordPage = lazyPage(() => import('../pages/ChangePasswordPage'), routeStyles.admin);
const HomePage = lazyPage(() => import('../pages/HomePage'), routeStyles.home);
const LoginPage = lazyPage(() => import('../pages/LoginPage'), routeStyles.login);
const MorePage = lazyPage(() => import('../pages/MorePage'), routeStyles.more, routeStyles.offline);
const CatalogsPage = lazyPage(() => import('../pages/admin/CatalogsPage'), routeStyles.admin);
const ClientsPage = lazyPage(() => import('../pages/admin/ClientsPage'), routeStyles.admin, routeStyles.clients);
const LegacyTicketsImportPage = lazyPage(() => import('../pages/admin/LegacyTicketsImportPage'), routeStyles.admin, routeStyles.legacy);
const MaintenanceQuestionsPage = lazyPage(() => import('../pages/admin/MaintenanceQuestionsPage'), routeStyles.admin, routeStyles.maintenance);
const MetricsPage = lazyPage(() => import('../pages/admin/MetricsPage'), routeStyles.metrics);
const AssistantPage = lazyPage(() => import('../pages/assistant/AssistantPage'), routeStyles.assistant);
const CustomerCasesPage = lazyPage(() => import('../pages/cases/CustomerCasesPage'));
const CustomerCaseDetailPage = lazyPage(() => import('../pages/cases/CustomerCaseDetailPage'));
const PublicCustomerCasePage = lazyPage(() => import('../pages/cases/PublicCustomerCasePage'));
const KnowledgeCategoriesPage = lazyPage(() => import('../pages/knowledge/KnowledgeCategoriesPage'), routeStyles.knowledge, routeStyles.admin);
const KnowledgeDetailPage = lazyPage(() => import('../pages/knowledge/KnowledgeDetailPage'), routeStyles.knowledge);
const KnowledgeEditorPage = lazyPage(() => import('../pages/knowledge/KnowledgeEditorPage'), routeStyles.knowledge);
const KnowledgeListPage = lazyPage(() => import('../pages/knowledge/KnowledgeListPage'), routeStyles.knowledge);
const MaintenanceDetailPage = lazyPage(() => import('../pages/maintenance/MaintenanceDetailPage'), routeStyles.maintenance);
const MaintenanceFormPage = lazyPage(() => import('../pages/maintenance/MaintenanceFormPage'), routeStyles.maintenance);
const MaintenanceListPage = lazyPage(() => import('../pages/maintenance/MaintenanceListPage'), routeStyles.maintenance);
const OfflineContentPage = lazyPage(() => import('../pages/offline/OfflineContentPage'), routeStyles.offline);
const PublicSurveyPage = lazyPage(() => import('../pages/surveys/PublicSurveyPage'), routeStyles.surveys);
const SurveyDetailPage = lazyPage(() => import('../pages/surveys/SurveyDetailPage'), routeStyles.surveys, routeStyles.admin);
const SurveysAdminPage = lazyPage(() => import('../pages/surveys/SurveysAdminPage'), routeStyles.surveys, routeStyles.admin);
const PublicSignaturePage = lazyPage(() => import('../pages/tickets/PublicSignaturePage'), routeStyles.tickets);
const TicketDetailWithQuickEdit = lazyPage(() => import('../pages/tickets/TicketDetailWithQuickEdit'), routeStyles.tickets);
const TicketFormPage = lazyPage(() => import('../pages/tickets/TicketFormPage'), routeStyles.tickets);
const TicketListPage = lazyPage(() => import('../pages/tickets/TicketListPage'), routeStyles.tickets);
const TicketQuickEditPage = lazyPage(() => import('../pages/tickets/TicketQuickEditPage'), routeStyles.tickets);
const TicketRelatedVisitPage = lazyPage(() => import('../pages/tickets/TicketRelatedVisitPage'), routeStyles.tickets);
const UserDetailPage = lazyPage(() => import('../pages/users/UserDetailPage'), routeStyles.admin);
const UserFormPage = lazyPage(() => import('../pages/users/UserFormPage'), routeStyles.admin);
const UsersPage = lazyPage(() => import('../pages/users/UsersPage'), routeStyles.admin);

const MAINTENANCE_VIEW = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER','USUARIOS_GESTIONAR'];
const MAINTENANCE_CREATE = ['MANTENIMIENTOS_CREAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const MAINTENANCE_EDIT = ['MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_EDITAR','USUARIOS_GESTIONAR'];
const KNOWLEDGE_CREATE = ['CONOCIMIENTO_CREAR','CONOCIMIENTO_GESTIONAR','BOLETAS_CREAR','USUARIOS_GESTIONAR'];
const CATALOG_VIEW = ['CATALOGOS_VER','CATALOGOS_GESTIONAR','USUARIOS_GESTIONAR'];

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

function OptionalOfflineRuntime() {
  const [offlineEnabled] = useOfflineMode();

  useEffect(() => {
    if (offlineEnabled) import('../services/ticketVisitOfflineSync');
  }, [offlineEnabled]);

  if (!offlineEnabled) return null;
  return <Suspense fallback={null}>
    <ClientCatalogSyncBridge />
    <MaintenanceFinalizationCenter />
  </Suspense>;
}

export default function App() {
  return <>
    <FormRecoveryRuntime />
    <OptionalOfflineRuntime />
    <Suspense fallback={null}><ActionProcessingBridge /></Suspense>
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
