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
  assert.match(gallery, /@media \(max-width: 760px\)[\s\S]*\.maintenance-lightbox--gallery[\s\S]*env\(safe-area-inset-left\)/s);
  assert.match(gallery, /\.maintenance-lightbox__image\s*\{[^}]*max-width:\s*100% !important[^}]*100dvh/s);
  assert.match(gallery, /@media \(max-width: 430px\)[\s\S]*padding-left:\s*max\(6px, env\(safe-area-inset-left\)\)/s);
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
  assert.match(styles, /max-height:calc\(100dvh - max\(8px,env\(safe-area-inset-top\)\)\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
});
