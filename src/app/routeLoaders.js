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

function loadWithAssets(loadPage, ...loadAssets) {
  return async () => {
    const [page] = await Promise.all([loadPage(), ...loadAssets.map((load) => load())]);
    return page;
  };
}

export const loadChangePasswordPage = loadWithAssets(() => import('../pages/ChangePasswordPage'), routeStyles.admin);
export const loadHomePage = loadWithAssets(() => import('../pages/HomePage'), routeStyles.home);
export const loadLoginPage = loadWithAssets(() => import('../pages/LoginPage'), routeStyles.login);
export const loadMorePage = loadWithAssets(() => import('../pages/MorePage'), routeStyles.more, routeStyles.offline);
export const loadAgendaPage = loadWithAssets(() => import('../pages/agenda/AgendaPage'));
export const loadCatalogsPage = loadWithAssets(() => import('../pages/admin/CatalogsPage'), routeStyles.admin);
export const loadClientsPage = loadWithAssets(() => import('../pages/admin/ClientsPage'), routeStyles.admin, routeStyles.clients);
export const loadLegacyTicketsImportPage = loadWithAssets(() => import('../pages/admin/LegacyTicketsImportPage'), routeStyles.admin, routeStyles.legacy);
export const loadMaintenanceQuestionsPage = loadWithAssets(() => import('../pages/admin/MaintenanceQuestionsPage'), routeStyles.admin, routeStyles.maintenance);
export const loadMetricsPage = loadWithAssets(() => import('../pages/admin/MetricsPage'), routeStyles.metrics);
export const loadNotificationSettingsPage = loadWithAssets(() => import('../pages/admin/NotificationSettingsPage'), routeStyles.admin);
export const loadAssistantPage = loadWithAssets(() => import('../pages/assistant/AssistantPage'), routeStyles.assistant);
export const loadCustomerCasesPage = loadWithAssets(() => import('../pages/cases/CustomerCasesPage'));
export const loadCustomerCaseDetailPage = loadWithAssets(() => import('../pages/cases/CustomerCaseDetailPage'));
export const loadPublicCustomerCasePage = loadWithAssets(() => import('../pages/cases/PublicCustomerCasePage'));
export const loadKnowledgeCategoriesPage = loadWithAssets(() => import('../pages/knowledge/KnowledgeCategoriesPage'), routeStyles.knowledge, routeStyles.admin);
export const loadKnowledgeDetailPage = loadWithAssets(() => import('../pages/knowledge/KnowledgeDetailPage'), routeStyles.knowledge);
export const loadKnowledgeEditorPage = loadWithAssets(() => import('../pages/knowledge/KnowledgeEditorPage'), routeStyles.knowledge);
export const loadKnowledgeListPage = loadWithAssets(() => import('../pages/knowledge/KnowledgeListPage'), routeStyles.knowledge);
export const loadMaintenanceDetailPage = loadWithAssets(() => import('../pages/maintenance/MaintenanceDetailPage'), routeStyles.maintenance);
export const loadMaintenanceFormPage = loadWithAssets(() => import('../pages/maintenance/MaintenanceFormPage'), routeStyles.maintenance);
export const loadMaintenanceListPage = loadWithAssets(() => import('../pages/maintenance/MaintenanceListPage'), routeStyles.maintenance);
export const loadOfflineContentPage = loadWithAssets(() => import('../pages/offline/OfflineContentPage'), routeStyles.offline);
export const loadPasswordVaultPage = loadWithAssets(() => import('../pages/security/PasswordVaultPage'));
export const loadPublicSurveyPage = loadWithAssets(() => import('../pages/surveys/PublicSurveyPage'), routeStyles.surveys);
export const loadSurveyDetailPage = loadWithAssets(() => import('../pages/surveys/SurveyDetailPage'), routeStyles.surveys, routeStyles.admin);
export const loadSurveysAdminPage = loadWithAssets(() => import('../pages/surveys/SurveysAdminPage'), routeStyles.surveys, routeStyles.admin);
export const loadPublicSignaturePage = loadWithAssets(() => import('../pages/tickets/PublicSignaturePage'), routeStyles.tickets);
export const loadTicketDetailWithQuickEdit = loadWithAssets(() => import('../pages/tickets/TicketDetailWithQuickEdit'), routeStyles.tickets);
export const loadTicketFormPage = loadWithAssets(() => import('../pages/tickets/TicketFormPage'), routeStyles.tickets);
export const loadTicketListPage = loadWithAssets(() => import('../pages/tickets/TicketListPage'), routeStyles.tickets);
export const loadTicketQuickEditPage = loadWithAssets(() => import('../pages/tickets/TicketQuickEditPage'), routeStyles.tickets);
export const loadTicketRelatedVisitPage = loadWithAssets(() => import('../pages/tickets/TicketRelatedVisitPage'), routeStyles.tickets);
export const loadUserDetailPage = loadWithAssets(() => import('../pages/users/UserDetailPage'), routeStyles.admin);
export const loadUserFormPage = loadWithAssets(() => import('../pages/users/UserFormPage'), routeStyles.admin);
export const loadUsersPage = loadWithAssets(() => import('../pages/users/UsersPage'), routeStyles.admin);

const warmedLoads = new Map();

function preload(loader) {
  if (!loader) return Promise.resolve(null);
  if (!warmedLoads.has(loader)) {
    warmedLoads.set(loader, loader().catch(() => null));
  }
  return warmedLoads.get(loader);
}

export function loaderForPath(pathname = '/') {
  const path = String(pathname || '/').split('?')[0];
  if (path === '/') return loadHomePage;
  if (path === '/agenda') return loadAgendaPage;
  if (path === '/asistente') return loadAssistantPage;
  if (path === '/boletas/pendientes' || path === '/boletas/finalizadas') return loadTicketListPage;
  if (path === '/boletas/nueva') return loadTicketFormPage;
  if (/^\/boletas\/[^/]+\/editar-rapido\//.test(path)) return loadTicketQuickEditPage;
  if (/^\/boletas\/[^/]+\/nueva-visita$/.test(path)) return loadTicketRelatedVisitPage;
  if (/^\/boletas\/[^/]+\/editar$/.test(path)) return loadTicketFormPage;
  if (/^\/boletas\/[^/]+$/.test(path)) return loadTicketDetailWithQuickEdit;
  if (path === '/mantenimientos') return loadMaintenanceListPage;
  if (path === '/mantenimientos/nuevo') return loadMaintenanceFormPage;
  if (/^\/mantenimientos\/[^/]+\/editar$/.test(path)) return loadMaintenanceFormPage;
  if (/^\/mantenimientos\/[^/]+$/.test(path)) return loadMaintenanceDetailPage;
  if (path === '/conocimiento') return loadKnowledgeListPage;
  if (path === '/conocimiento/nuevo') return loadKnowledgeEditorPage;
  if (path === '/conocimiento/categorias') return loadKnowledgeCategoriesPage;
  if (/^\/conocimiento\/[^/]+\/editar$/.test(path)) return loadKnowledgeEditorPage;
  if (/^\/conocimiento\/[^/]+$/.test(path)) return loadKnowledgeDetailPage;
  if (path === '/clientes') return loadClientsPage;
  if (path === '/catalogos') return loadCatalogsPage;
  if (path === '/usuarios') return loadUsersPage;
  if (path === '/metricas') return loadMetricsPage;
  if (path === '/mas') return loadMorePage;
  if (path === '/cambiar-contrasena') return loadChangePasswordPage;
  return null;
}

export function preloadRouteModule(pathname) {
  return preload(loaderForPath(pathname));
}

export function preloadRouteModules(pathnames = []) {
  return Promise.allSettled([...new Set(pathnames)].map((pathname) => preloadRouteModule(pathname)));
}
