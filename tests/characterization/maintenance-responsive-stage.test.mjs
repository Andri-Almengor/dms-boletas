import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('listado de mantenimientos usa ancho wide y conserva paginación sync y offline existentes', () => {
  const page = source('src/pages/maintenance/MaintenanceListPage.jsx');

  assert.match(page, /className="page page--wide maintenance-page"/);
  assert.match(page, /usePaginatedResource/);
  assert.match(page, /MAINTENANCE_LIST_PAGE_SIZE/);
  assert.match(page, /requestSynchronizedCollection/);
  assert.match(page, /subscribeSyncResource/);
  assert.match(page, /readOfflineMaintenancePage/);
  assert.match(page, /<FilterDrawer/);
});

test('búsqueda y filtros de mantenimientos son táctiles y accesibles sin duplicar controles móviles', () => {
  const page = source('src/pages/maintenance/MaintenanceListPage.jsx');
  const listStyles = source('src/styles/maintenance-enhancements.css');
  const inventoryStyles = source('src/styles/maintenance-inventory-location-filters.css');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(page, /role="search"/);
  assert.match(page, /type="search"/);
  assert.match(page, /enterKeyHint="search"/);
  assert.match(page, /aria-expanded=\{filterOpen\}/);
  assert.match(listStyles, /\.maintenance-list-search-bar\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) 44px 44px/s);

  assert.match(inventory, /aria-label="Buscar dispositivos del mantenimiento"/);
  assert.match(inventory, /enterKeyHint="search"/);
  assert.match(inventory, /aria-expanded=\{filterOpen\}/);
  assert.match(inventoryStyles, /@media \(max-width: 880px\)[\s\S]*\.maintenance-inventory-inline-filter\s*\{[^}]*display:\s*none/s);
  assert.match(inventoryStyles, /grid-template-columns:\s*minmax\(0, 1fr\) 44px/);
});

test('listado escala a tres columnas solo en escritorio amplio y mantiene una en teléfono', () => {
  const styles = source('src/styles/maintenance.css');

  assert.match(styles, /\.maintenance-page\{width:min\(100%,var\(--page-wide-max-width\)\)\}/);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.maintenance-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media\(max-width:760px\)\{\.maintenance-grid,[^}]*grid-template-columns:1fr/);
});

test('acciones secundarias del detalle forman un rail táctil y finalización permanece visible', () => {
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');
  const styles = source('src/styles/maintenance-mobile-groups-collapse.css');

  assert.match(detail, /className="maintenance-report-actions" aria-label="Acciones del mantenimiento"/);
  assert.match(detail, /className="maintenance-detail-footer-actions"/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.maintenance-report-actions\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(styles, /\.maintenance-detail-footer-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*calc\(var\(--bottom-nav-height\)/s);
});

test('resumen móvil de mantenimiento usa dos columnas y se reduce a una en teléfonos estrechos', () => {
  const styles = source('src/styles/maintenance-mobile-groups-collapse.css');

  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.maintenance-mobile-fold \.maintenance-detail-summary__grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.maintenance-mobile-fold \.maintenance-detail-summary__grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('galería técnica mantiene dos miniaturas en móvil y el lightbox aprovecha safe areas', () => {
  const groups = source('src/styles/maintenance-mobile-groups-collapse.css');
  const gallery = source('src/styles/maintenance-evidence-gallery.css');

  assert.match(groups, /\.maintenance-inventory-images\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(gallery, /@media \(max-width: 760px\)[\s\S]*\.maintenance-lightbox--gallery[\s\S]*var\(--safe-area-left\)/s);
  assert.match(gallery, /\.maintenance-lightbox__image\s*\{[^}]*max-width:\s*100% !important[^}]*100dvh/s);
  assert.match(gallery, /@media \(max-width: 430px\)[\s\S]*padding-left:\s*max\(6px, var\(--safe-area-left\)\)/s);
});

test('overlays de mantenimientos reutilizan bloqueo compartido sin tocar sus operaciones', () => {
  const picker = source('src/components/maintenance/MaintenanceLocationPickerModal.jsx');
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const editor = source('src/components/maintenance/MaintenanceEvidenceEditor.jsx');
  const creator = source('src/components/maintenance/MaintenanceQuickDeviceCreator.jsx');
  const viewer = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');

  assert.match(picker, /useOverlaySurface\(\{ open, onClose, busy: saving \}\)/);
  assert.match(uploader, /useOverlaySurface\(\{ open: true, onClose, busy: saving \}\)/);
  assert.match(editor, /useOverlaySurface\(\{ open: true, onClose, busy: saving \}\)/);
  assert.match(creator, /useOverlaySurface\(\{ open: true, onClose, busy: saving \}\)/);
  assert.match(viewer, /useOverlaySurface\(\{ open, onClose: closeFullImage \}\)/);

  assert.match(uploader, /uploadMaintenanceImagesInBatches/);
  assert.match(editor, /MODULE_ROUTES\.maintenance\.imageUpdate/);
  assert.match(editor, /MODULE_ROUTES\.maintenance\.imageDelete/);
  assert.match(creator, /MODULE_ROUTES\.maintenance\.deviceCreate/);
  assert.match(creator, /MODULE_ROUTES\.maintenance\.deviceUpdate/);
});

test('modal de evidencias usa viewport dinámico para teclado y barras móviles', () => {
  const styles = source('src/styles/maintenance-enhancements.css');

  assert.match(styles, /max-height:calc\(100dvh - 36px\)/);
  assert.match(styles, /max-height:var\(--overlay-mobile-max-height\)/);
  assert.match(styles, /var\(--safe-area-bottom\)/);
});


test('Etapa 6 conserva consulta y scroll del listado al abrir un mantenimiento', () => {
  const list = source('src/pages/maintenance/MaintenanceListPage.jsx');
  const detail = source('src/pages/maintenance/MaintenanceDetailPage.jsx');

  assert.match(list, /readMaintenanceFilters\(searchParams\)/);
  assert.match(list, /buildMaintenanceListSearch\(status, search, filters\)/);
  assert.match(list, /maintenanceListReturnTo: currentListUrl/);
  assert.match(list, /maintenanceListScrollY:/);
  assert.match(list, /restoreScrollY/);
  assert.match(detail, /maintenanceListReturnTo = \/\^\\\/mantenimientos\(\?:\\\?\|\$\)\//);
  assert.match(detail, /maintenanceListReturnState/);
  assert.match(detail, /navigate\(maintenanceListReturnTo, \{ state: maintenanceListReturnState \}\)/);
});

test('Etapa 6 mantiene dispositivo de proyecto en ruta independiente con navegación anterior y siguiente', () => {
  const app = source('src/app/App.jsx');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');
  const route = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');

  assert.match(app, /mantenimientos\/:maintenanceId\/dispositivos\/:deviceId/);
  assert.match(inventory, /if \(projectMode\)[\s\S]*\/dispositivos\/\$\{encodeURIComponent\(id\)\}/s);
  assert.match(inventory, /deviceIds/);
  assert.match(inventory, /\.\.\.routeLocation\.state/);
  assert.match(route, /const previousId =/);
  assert.match(route, /const nextId =/);
  assert.match(route, /goToDevice\(previousId\)/);
  assert.match(route, /goToDevice\(nextId\)/);
  assert.match(route, /replace: true/);
});

test('Etapa 6 conserva contexto a través de dispositivo proyecto y edición directa', () => {
  const route = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const direct = source('src/features/maintenance/useMaintenanceDirectDevice.js');
  const base = source('src/hooks/useOptimizedMaintenanceBase.js');
  const scalable = source('src/hooks/useScalableMaintenanceForm.js');

  assert.match(route, /maintenanceDetailState\(\)/);
  assert.match(route, /const \{ returnTo: _returnTo, deviceIds: _deviceIds, \.\.\.rest \} = location\.state/);
  assert.match(route, /\.\.\.location\.state,[\s\S]*returnTo:/s);
  assert.match(form, /navigationState: location\.state/);
  assert.match(form, /returnState: location\.state/);
  assert.match(direct, /state: returnState/);
  assert.match(base, /navigationState \? \{ state: navigationState \} : undefined/);
  assert.match(scalable, /navigationState \? \{ state: navigationState \} : undefined/);
});

test('Etapa 6 usa targets y safe areas compartidos en inventario, evidencias y editor', () => {
  const locations = source('src/styles/maintenance-location-workflow.css');
  const enhancements = source('src/styles/maintenance-enhancements.css');
  const editor = source('src/styles/maintenance-device-mobile-ux.css');
  const inventory = source('src/styles/maintenance-inventory-mobile.css');
  const deviceInventory = source('src/styles/maintenance-device-inventory.css');
  const project = source('src/styles/maintenance-project.css');

  assert.doesNotMatch(locations, /var\(--text-muted\)/);
  assert.doesNotMatch(locations, /var\(--text-main\)/);
  assert.match(locations, /\.maintenance-location-work-group__actions \.icon-button\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)/s);
  assert.match(locations, /max-height:\s*var\(--overlay-mobile-max-height\)/);
  assert.match(enhancements, /button\.maintenance-query-chip\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
  assert.match(enhancements, /grid-template-columns:\s*22px minmax\(0, 1fr\) var\(--touch-target-min\) var\(--touch-target-min\)/);
  assert.match(editor, /\.maintenance-image-type-toggle button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
  assert.doesNotMatch(editor, /100vw/);
  assert.match(inventory, /var\(--safe-area-bottom\)/);
  assert.match(deviceInventory, /\.maintenance-inventory-images figure > button\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
  assert.match(project, /\.maintenance-project-evidence-filter select\s*\{[^}]*min-height:\s*var\(--control-height-compact\)/s);
});

test('Etapa 6 conserva la galería de proyecto compacta y el visor de evidencias existente', () => {
  const detail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');
  const project = source('src/styles/maintenance-project.css');

  assert.match(detail, /MaintenanceEvidenceImage/);
  assert.match(detail, /galleryImages=\{images\}/);
  assert.match(detail, /maintenance-project-device-gallery/);
  assert.match(project, /@media \(max-width: 760px\)[\s\S]*\.maintenance-project-device-gallery\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(project, /aspect-ratio:\s*4 \/ 3/);
});
