import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cameraSignature } from '../../gateway-agent/src/adapters/camera-brand-signatures.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('las firmas reconocen las marcas principales sin confundir Hanwha con Provision-ISR', () => {
  assert.deepEqual(cameraSignature('PND-A7082RV'), { manufacturer: 'Hanwha Vision', model: 'PND-A7082RV' });
  assert.deepEqual(cameraSignature('TVD-3101'), { manufacturer: 'TruVision', model: 'TVD-3101' });
  assert.deepEqual(cameraSignature('TVT-5602'), { manufacturer: 'TruVision', model: 'TVT-5602' });
  assert.deepEqual(cameraSignature('DI-390IPSVF'), { manufacturer: 'Provision-ISR', model: 'DI-390IPSVF' });
  assert.deepEqual(cameraSignature('AXIS P3717-PLE'), { manufacturer: 'AXIS', model: 'AXIS P3717-PLE' });
  assert.equal(cameraSignature('i-PRO WV-S1536L').manufacturer, 'i-PRO');
  assert.equal(cameraSignature('Eagle Eye Networks camera').manufacturer, 'Eagle Eye Networks');
});

test('el token recuperable se cifra separado del hash y nunca se devuelve en el overview', () => {
  const secret = source('backend/src/services/integration-gateway-secret.service.js');
  const gatewayService = source('backend/src/services/integration-gateway.service.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  assert.match(secret, /aes-256-gcm/);
  assert.match(secret, /INTEGRATION_GATEWAY_ENCRYPTION_KEY/);
  assert.match(secret, /TokenCiphertext/);
  assert.doesNotMatch(secret, /TokenPlaintext/);
  assert.match(gatewayService, /TokenHash/);
  assert.match(routes, /backfillIntegrationGatewayToken/);
  assert.match(routes, /\/admin\/credentials\/reveal/);
  assert.match(routes, /REVELAR_TOKEN_GATEWAY_INTEGRACION/);
});

test('la edición y el movimiento masivo validan ubicaciones del cliente', () => {
  const service = source('backend/src/services/integration-device-admin.service.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  assert.match(service, /UbicacionClienteID/);
  assert.match(service, /UbicacionEquipoID/);
  assert.match(service, /ClienteUbicaciones/);
  assert.match(service, /ClienteUbicacionesEquipo/);
  assert.match(service, /updateIntegrationDevicesLocation/);
  assert.match(service, /La asignación masiva solo admite dispositivos de un mismo cliente/);
  assert.match(service, /Seleccione la Ubicación del equipo donde se agruparán las cámaras/);
  assert.match(routes, /\/admin\/devices\/profile/);
  assert.match(routes, /\/admin\/devices\/location\/batch/);
  assert.match(routes, /MOVER_DISPOSITIVOS_INTEGRACION_UBICACION/);
});

test('la interfaz agrupa por ubicación, filtra por cliente y oculta simulaciones operativas', () => {
  const page = source('src/pages/admin/IntegrationsPage.jsx');
  const adminStyles = source('src/styles/routes/admin.js');
  const styles = source('src/styles/integration-gateway.css');
  const api = source('src/services/integrationGatewayApi.js');
  assert.match(page, /InlineCreateModal/);
  assert.match(page, /Crear gateway/);
  assert.match(page, /integration-gateway-section--collapsible/);
  assert.match(page, /integration-gateway-credentials/);
  assert.match(page, /Todos los clientes/);
  assert.match(page, /Todas las marcas/);
  assert.match(page, /Todos los modelos/);
  assert.match(page, /buildLocationFolders/);
  assert.match(page, /integration-location-folder/);
  assert.match(page, /Seleccionar todas las filtradas/);
  assert.match(page, /Asignar ubicación/);
  assert.match(page, /SourceSystem \|\| ''\)\.toUpperCase\(\) !== 'SIMULATED'/);
  assert.match(page, /Ubicación del cliente/);
  assert.match(page, /Ubicación del equipo/);
  assert.match(page, /Nombre operativo/);
  assert.match(styles, /:root\[data-theme='dark'\] \.integration-gateway-credentials/);
  assert.match(styles, /var\(--surface-card/);
  assert.match(adminStyles, /maintenance-device-inventory\.css/);
  assert.match(api, /revealIntegrationGatewayToken/);
  assert.match(api, /updateIntegrationDeviceProfile/);
  assert.match(api, /updateIntegrationDevicesLocation/);
});
