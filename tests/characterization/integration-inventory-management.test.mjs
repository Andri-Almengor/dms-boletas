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

test('la edición de cámara conserva nombre operativo y valida ubicaciones del cliente', () => {
  const service = source('backend/src/services/integration-device-admin.service.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  assert.match(service, /UbicacionClienteID/);
  assert.match(service, /UbicacionEquipoID/);
  assert.match(service, /ClienteUbicaciones/);
  assert.match(service, /ClienteUbicacionesEquipo/);
  assert.match(service, /no pertenece al cliente del gateway/i);
  assert.match(routes, /\/admin\/devices\/profile/);
  assert.match(routes, /ACTUALIZAR_PERFIL_DISPOSITIVO_INTEGRACION/);
});

test('la interfaz usa modal de creación, credenciales desplegables y filtros de mantenimiento', () => {
  const page = source('src/pages/admin/IntegrationsPage.jsx');
  const adminStyles = source('src/styles/routes/admin.js');
  const api = source('src/services/integrationGatewayApi.js');
  assert.match(page, /InlineCreateModal/);
  assert.match(page, /Crear gateway/);
  assert.match(page, /integration-gateway-credentials/);
  assert.match(page, /Todos los clientes/);
  assert.match(page, /Todas las marcas/);
  assert.match(page, /Todos los modelos/);
  assert.match(page, /maintenance-device-table/);
  assert.match(page, /Ubicación del cliente/);
  assert.match(page, /Nombre operativo/);
  assert.match(adminStyles, /maintenance-device-inventory\.css/);
  assert.match(api, /revealIntegrationGatewayToken/);
  assert.match(api, /updateIntegrationDeviceProfile/);
});
