import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Proyecto abre cada dispositivo en una ruta protegida propia sin crear permisos nuevos', () => {
  const app = source('src/app/App.jsx');
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(app, /MaintenanceProjectDeviceDetailPage/);
  assert.match(app, /mantenimientos\/:maintenanceId\/dispositivos\/:deviceId/);
  assert.match(app, /PermissionRoute anyOf=\{MAINTENANCE_VIEW\}/);

  assert.match(inventory, /useNavigate/);
  assert.match(inventory, /if \(projectMode\)/);
  assert.match(inventory, /\/mantenimientos\/\$\{encodeURIComponent\(maintenanceId/);
  assert.match(inventory, /\/dispositivos\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(inventory, /deviceIds = visibleGroups\.flatMap/);
  assert.match(inventory, /returnTo:/);
});

test('Mantenimiento normal abre cada dispositivo dentro de su tarjeta y Proyecto conserva la ruta dedicada', () => {
  const inventory = source('src/components/maintenance/MaintenanceLocationInventory.jsx');

  assert.match(inventory, /const \[openDeviceIds, setOpenDeviceIds\] = useState\(\(\) => new Set\(\)\)/);
  assert.match(inventory, /maintenance-inventory-device-cards/);
  assert.match(inventory, /maintenance-inventory-device-card\$\{expanded \? ' is-expanded' : ''\}/);
  assert.match(inventory, /aria-expanded=\{expanded\}/);
  assert.match(inventory, /expanded && <div id=\{detailId\} className="maintenance-inventory-device-card__detail">\{deviceDetailContent\(device\)\}<\/div>/);
  assert.doesNotMatch(inventory, /AdminEntityModal/);
  assert.doesNotMatch(inventory, /activeDetailDevice/);
  assert.match(inventory, /if \(projectMode\)[\s\S]*\/dispositivos\/\$\{encodeURIComponent\(id\)\}/s);
  assert.match(inventory, /<Icon name="open_in_new" \/>/);
});

test('ruta de dispositivo reutiliza la lectura sincronizada y el flujo offline del mantenimiento', () => {
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');

  assert.match(page, /requestSynchronizedDetail/);
  assert.match(page, /requestAvailable\(MODULE_ROUTES\.maintenance\.get/);
  assert.match(page, /subscribeSyncEntity\('maintenance', maintenanceId/);
  assert.match(page, /navigator\.onLine === false/);
  assert.match(page, /dms-offline-sync-complete/);
  assert.match(page, /security-invalidated/);
});

test('ruta permite desplazarse y volver al origen sin depender del historial del navegador', () => {
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');

  assert.match(page, /normalizedNavigationIds\(location\.state\?\.deviceIds, devices\)/);
  assert.match(page, /const previousId =/);
  assert.match(page, /const nextId =/);
  assert.match(page, /function goToDevice/);
  assert.match(page, /requestedReturnUrl === maintenanceDetailUrl/);
  assert.match(page, /requestedReturnUrl\.startsWith\(\`\$\{maintenanceDetailUrl\}\?\`\)/);
  assert.match(page, /navigate\(returnUrl, \{ replace: true, state: maintenanceDetailState\(\) \}\)/);
  assert.doesNotMatch(page, /navigate\(-1\)/);
  assert.match(page, /replace: true/);
  assert.match(page, />Anterior</);
  assert.match(page, />Siguiente</);
  assert.match(page, /Volver a dispositivos/);
});

test('editar desde la ruta dedicada conserva retorno al mismo dispositivo', () => {
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');
  const form = source('src/pages/maintenance/MaintenanceFormPage.jsx');
  const hook = source('src/features/maintenance/useMaintenanceDirectDevice.js');

  assert.match(page, /state:\s*\{[\s\S]*returnTo:\s*\`\/mantenimientos\/\$\{encodeURIComponent\(maintenanceId\)\}\/dispositivos\/\$\{encodeURIComponent\(id\)\}\`/s);
  assert.match(form, /returnTo: location\.state\?\.returnTo/);
  assert.match(form, /returnState: location\.state/);
  assert.match(hook, /requestedReturnUrl\.startsWith\(\`\$\{detailUrl\}\/\`\)/);
  assert.match(hook, /navigate\(returnUrl, \{ replace: true, state: returnState \}\)/);
});

test('detalle reutilizable muestra identificación completa, relaciones configurables y progreso', () => {
  const detail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');

  for (const label of [
    'Tipo',
    'Ubicación',
    'Marca',
    'Modelo',
    'Serie',
    'Dirección MAC',
    'Fecha de trabajo',
    'Técnicos',
    'Estado',
    'Evidencias',
  ]) {
    assert.ok(detail.includes(`<span>${label}</span>`), `Falta ${label} en el resumen del dispositivo`);
  }

  assert.match(detail, /function ProjectDeviceAnswers/);
  assert.match(detail, /RELACION_DISPOSITIVO/);
  assert.match(detail, /maintenance-project-detail-components/);
  assert.match(detail, /MaintenanceProjectProgressChecklist checklist=\{projectChecklist\}/);
});

test('galería de la ruta usa el visor existente y mantiene carga y edición de evidencias', () => {
  const detail = source('src/components/maintenance/MaintenanceProjectDeviceDetail.jsx');
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');

  assert.match(detail, /projectEvidenceTargets\(device/);
  assert.match(detail, /projectEvidenceTargetValue\(image\) === evidenceTargetFilter/);
  assert.ok(detail.includes('Todas las evidencias'));
  assert.match(detail, /<MaintenanceEvidenceImage image=\{image\} galleryImages=\{images\}/);
  assert.match(detail, /onAddEvidence\(device\)/);
  assert.match(detail, /onEditEvidence\(image, device\)/);

  assert.match(page, /<MaintenanceEvidenceUploader/);
  assert.match(page, /<MaintenanceEvidenceEditor/);
  assert.match(page, /onUploaded=\{\(\) => load/);
  assert.match(page, /onUpdated=\{\(\) => load/);
});

test('galería responsive limita miniaturas para que una sola evidencia no se vuelva gigante', () => {
  const styles = source('src/styles/maintenance-project.css');

  assert.match(styles, /\.maintenance-project-device-gallery/);
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fill, minmax\(170px, 220px\)\)/);
  assert.match(styles, /max-width:\s*220px/);
  assert.match(styles, /aspect-ratio:\s*4 \/ 3/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.maintenance-project-device-gallery[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('detalle de proyecto es una página responsive y no una extensión visual de la tabla', () => {
  const page = source('src/pages/maintenance/MaintenanceProjectDeviceDetailPage.jsx');
  const styles = source('src/styles/maintenance-project.css');

  assert.match(page, /maintenance-project-device-detail-page/);
  assert.match(page, /maintenance-project-device-route-header/);
  assert.match(page, /maintenance-project-device-route-navigation/);
  assert.match(page, /<MaintenanceProjectDeviceDetail/);

  assert.match(styles, /\.maintenance-project-device-detail-page/);
  assert.match(styles, /\.maintenance-project-device-route-header/);
  assert.match(styles, /\.maintenance-project-device-route-navigation/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
