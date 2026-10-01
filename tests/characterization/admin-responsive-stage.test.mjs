import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Usuarios Clientes Catálogos y Preguntas reutilizan las rutas y permisos existentes', () => {
  const users = source('src/pages/users/UsersPage.jsx');
  const clients = source('src/pages/admin/ClientsPage.jsx');
  const catalogs = source('src/pages/admin/CatalogsPage.jsx');
  const questions = source('src/pages/admin/MaintenanceQuestionsPage.jsx');

  assert.match(users, /hasPermission\('USUARIOS_GESTIONAR'\)/);
  assert.match(users, /apiRequest\('users\.list'/);
  assert.match(clients, /hasPermission\('USUARIOS_GESTIONAR'\)/);
  assert.match(clients, /MODULE_ROUTES\.clients\.list/);
  assert.match(catalogs, /hasPermission\('CATALOGOS_VER'\)/);
  assert.match(catalogs, /hasPermission\('CATALOGOS_GESTIONAR'\)/);
  assert.match(questions, /hasPermission\('CATALOGOS_VER'\)/);
  assert.match(questions, /hasPermission\('CATALOGOS_GESTIONAR'\)/);
});

test('listas administrativas principales aprovechan page wide sin crear vistas móviles paralelas', () => {
  const users = source('src/pages/users/UsersPage.jsx');
  const clients = source('src/pages/admin/ClientsPage.jsx');
  const catalogs = source('src/pages/admin/CatalogsPage.jsx');
  const questions = source('src/pages/admin/MaintenanceQuestionsPage.jsx');

  assert.match(users, /page page--wide users-page/);
  assert.match(clients, /page page--wide admin-module-page clients-admin-page/);
  assert.match(catalogs, /page page--wide catalog-page/);
  assert.match(questions, /page page--wide maintenance-questions-page/);

  for (const page of [users, clients, catalogs, questions]) {
    assert.doesNotMatch(page, /Mobile[A-Z]|Desktop[A-Z]|ResponsiveV2|MobileV2/);
  }
});

test('búsquedas administrativas usan controles táctiles semánticos', () => {
  const users = source('src/pages/users/UsersPage.jsx');
  const clients = source('src/pages/admin/ClientsPage.jsx');
  const catalogs = source('src/pages/admin/CatalogsPage.jsx');
  const questions = source('src/pages/admin/MaintenanceQuestionsPage.jsx');

  assert.match(users, /role="search"/);
  assert.match(users, /type="search"/);
  assert.match(users, /enterKeyHint="search"/);

  assert.match(clients, /role="search"/);
  assert.match(clients, /aria-label="Buscar clientes"/);
  assert.match(clients, /enterKeyHint="search"/);

  assert.match(catalogs, /type="search"/);
  assert.match(catalogs, /enterKeyHint="search"/);

  assert.match(questions, /type="search"/);
  assert.match(questions, /enterKeyHint="search"/);
});

test('tarjetas de usuario acomodan Detalle y acciones sensibles sin cambiar handlers', () => {
  const users = source('src/pages/users/UsersPage.jsx');
  const styles = source('src/styles/admin-responsive-corrections.css');

  assert.match(users, /user-card__primary-action/);
  assert.match(users, /user-card__secondary-actions/);
  assert.match(users, /resetPassword\(record\)/);
  assert.match(users, /deactivateUser\(record\)/);

  assert.match(styles, /\.users-page \.user-card__secondary-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.users-page \.user-card__primary-action[\s\S]*flex:\s*1 0 100%/s);
  assert.match(styles, /@media \(max-width: 440px\)[\s\S]*\.users-page \.user-card__details[\s\S]*grid-template-columns:\s*1fr/s);
});

test('detalle y formulario de usuario conservan una sola superficie responsive', () => {
  const detail = source('src/pages/users/UserDetailPage.jsx');
  const form = source('src/pages/users/UserFormPage.jsx');
  const styles = source('src/styles/admin-responsive-corrections.css');

  assert.match(detail, /user-detail-page/);
  assert.match(form, /user-form-page/);
  assert.match(detail, /users\.password\.reset/);
  assert.match(form, /users\.create/);
  assert.match(form, /users\.update/);

  assert.match(styles, /\.user-detail-page \.detail-hero/);
  assert.match(styles, /\.user-form-page \.form-actions/);
});

test('Clientes sigue reutilizando AdminEntityModal y ClientRelationsManager', () => {
  const clients = source('src/pages/admin/ClientsPage.jsx');

  assert.match(clients, /<AdminEntityModal/);
  assert.match(clients, /className="admin-entity-modal-layer--client client-detail-modal"/);
  assert.match(clients, /<ClientRelationsManager/);
  assert.match(clients, /fetchClientRelations/);
  assert.match(clients, /mergePaginatedItems/);
});

test('Catálogos mantiene un único AdminEntityModal y tabs desplazables', () => {
  const page = source('src/pages/admin/CatalogsPage.jsx');
  const styles = source('src/styles/admin-responsive-corrections.css');

  assert.match(page, /<AdminEntityModal/);
  assert.match(page, /className="catalog-tabs"/);
  assert.match(styles, /\.catalog-tabs\s*\{[^}]*scroll-snap-type:\s*x proximity/s);
  assert.match(styles, /\.catalog-tabs button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
});

test('gestor de preguntas usa el overlay compartido y conserva Escape editor→gestor', () => {
  const page = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const styles = source('src/styles/maintenance-question-cards.css');

  assert.match(page, /useOverlaySurface\(\{/);
  assert.match(page, /open: Boolean\(selectedGroup\)/);
  assert.match(page, /if \(editor\) \{/);
  assert.match(page, /setEditor\(null\)/);
  assert.doesNotMatch(page, /document\.body\.classList\.add\('maintenance-question-manager-open'\)/);
  assert.doesNotMatch(styles, /body\.maintenance-question-manager-open/);

  assert.match(styles, /height:\s*var\(--overlay-mobile-max-height\)/);
  assert.match(styles, /\.maintenance-question-manager__editor \.form-control,[\s\S]*\.maintenance-question-search input[\s\S]*font-size:\s*16px/s);
});

test('Notificaciones mantiene correo y Chat independientes y evita zoom móvil en inputs', () => {
  const page = source('src/pages/admin/NotificationSettingsPage.jsx');
  const styles = source('src/styles/notification-settings.css');

  assert.match(page, /saveEmails/);
  assert.match(page, /saveWebhook/);
  assert.match(page, /testChat/);
  assert.match(page, /disableChat/);
  assert.match(page, /role="status"/);
  assert.match(page, /role="alert"/);

  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.notification-field-card textarea,[\s\S]*\.notification-chat-form input[\s\S]*font-size:\s*16px/s);
});

test('administración escala a tres columnas únicamente cuando existe espacio amplio', () => {
  const styles = source('src/styles/admin-responsive-corrections.css');

  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.users-page \.user-grid,[\s\S]*\.clients-admin-page \.admin-mini-card-grid,[\s\S]*\.catalog-page \.admin-mini-card-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/s);
});


test('Etapa 8 conserva búsqueda y retorno contextual en Usuarios', () => {
  const list = source('src/pages/users/UsersPage.jsx');
  const detail = source('src/pages/users/UserDetailPage.jsx');
  const form = source('src/pages/users/UserFormPage.jsx');

  assert.match(list, /const requestedSearch = searchParams\.get\('q'\) \|\| ''/);
  assert.match(list, /const \[submittedSearch, setSubmittedSearch\] = useState\(requestedSearch\)/);
  assert.match(list, /usersListReturnTo: currentListUrl/);
  assert.match(list, /usersListScrollY:/);
  assert.match(list, /restoreScrollY/);
  assert.match(list, /state=\{listReturnState\(\)\}/);

  assert.match(detail, /usersListReturnTo = \/\^\\\/usuarios\(\?:\\\?\|\$\)\//);
  assert.match(detail, /navigate\(usersListReturnTo, \{ state: usersListReturnState \}\)/);
  assert.match(detail, /state=\{routeLocation\.state\}/);

  assert.match(form, /navigation|routeLocation\.state/);
  assert.match(form, /usersListReturnState/);
  assert.match(form, /navigate\(detailUrl, routeLocation\.state \? \{ state: routeLocation\.state \} : undefined\)/);
});

test('Etapa 8 conserva contexto de Clientes Catálogos y Preguntas sin rutas paralelas', () => {
  const clients = source('src/pages/admin/ClientsPage.jsx');
  const catalogs = source('src/pages/admin/CatalogsPage.jsx');
  const questions = source('src/pages/admin/MaintenanceQuestionsPage.jsx');

  assert.match(clients, /const requestedSearch = searchParams\.get\('q'\) \|\| ''/);
  assert.match(clients, /setSearchParams\(next, \{ replace: true \}\)/);

  assert.match(catalogs, /const requestedTab = String\(searchParams\.get\('tab'\) \|\| ''\)/);
  assert.match(catalogs, /const requestedSearch = searchParams\.get\('q'\) \|\| ''/);
  assert.match(catalogs, /TABS\.some\(\(\[key\]\) => key === requestedTab\)/);
  assert.match(catalogs, /next\.set\('tab', nextTab\)/);
  assert.match(catalogs, /function changeSearch\(nextSearch\)/);
  assert.match(catalogs, /<AdminEntityModal/);

  assert.match(questions, /const requestedSearch = searchParams\.get\('q'\) \|\| ''/);
  assert.match(questions, /const requestedTypeId = searchParams\.get\('device'\) \|\| ''/);
  assert.match(questions, /function updateQuestionViewQuery/);
  assert.match(questions, /next\.set\('device', nextTypeId\)/);
  assert.match(questions, /function changeSearch\(nextSearch\)/);
  assert.match(questions, /useOverlaySurface\(\{/);
});

test('Etapa 8 reutiliza tokens globales para modales y targets administrativos', () => {
  const modal = source('src/styles/admin-card-modals.css');
  const admin = source('src/styles/admin-responsive-corrections.css');
  const questions = source('src/styles/maintenance-question-cards.css');

  assert.match(modal, /\.admin-mini-card__action\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)/s);
  assert.match(modal, /max-height:\s*var\(--overlay-mobile-max-height\)/);
  assert.doesNotMatch(admin, /var\(--text-muted\)/);
  assert.match(admin, /height:\s*var\(--overlay-mobile-max-height\)/);
  assert.match(admin, /var\(--safe-area-bottom\)/);

  assert.doesNotMatch(questions, /var\(--text-muted\)/);
  assert.match(questions, /\.maintenance-question-device-card__edit\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)/s);
  assert.match(questions, /background:\s*var\(--overlay-backdrop\)/);
  assert.match(questions, /height:\s*var\(--overlay-mobile-max-height\)/);
  assert.match(questions, /\.maintenance-question-related-fields \.checkbox-row\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
});
