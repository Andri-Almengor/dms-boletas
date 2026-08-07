import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createGatewayToken,
  createGatewayTokenRecord,
  integrationCommandDedupeKey,
  integrationDeviceId,
  normalizeIntegrationCommandType,
  normalizeInventoryItem,
  sanitizeIntegrationMetadata,
  verifyGatewayToken,
} from '../../backend/src/services/integration-gateway.domain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('los tokens del gateway se almacenan con scrypt y nunca en texto plano', () => {
  const token = createGatewayToken();
  const record = createGatewayTokenRecord(token);

  assert.ok(token.length >= 40);
  assert.notEqual(record.hash, token);
  assert.ok(record.salt);
  assert.equal(verifyGatewayToken(token, record.salt, record.hash), true);
  assert.equal(verifyGatewayToken(`${token}x`, record.salt, record.hash), false);
});

test('el inventario usa una identidad estable y elimina secretos de los metadatos', () => {
  const gateway = { GatewayID: 'gateway-1', ClienteID: 'client-1' };
  const item = {
    externalId: 'camera-guid-1',
    sourceSystem: 'SIMULATED',
    type: 'camera',
    name: 'Cámara entrada',
    status: 'online',
    metadata: {
      location: 'Entrada',
      password: 'no-debe-salir',
      nested: { token: 'tampoco', channel: 1 },
    },
  };
  const first = normalizeInventoryItem(item, gateway);
  const second = normalizeInventoryItem({ ...item, name: 'Cámara entrada renombrada' }, gateway);

  assert.equal(first.DispositivoIntegracionID, second.DispositivoIntegracionID);
  assert.equal(first.DispositivoIntegracionID, integrationDeviceId({
    gatewayId: 'gateway-1',
    sourceSystem: 'SIMULATED',
    externalId: 'camera-guid-1',
  }));
  assert.doesNotMatch(first.MetadataJSON, /no-debe-salir|tampoco/);
  assert.match(first.MetadataJSON, /Entrada/);
});

test('los comandos permitidos y su deduplicación permanecen declarativos', () => {
  assert.equal(normalizeIntegrationCommandType('ping'), 'PING');
  assert.equal(normalizeIntegrationCommandType('inventory_sync'), 'INVENTORY_SYNC');
  assert.equal(normalizeIntegrationCommandType('reboot-camera'), '');
  assert.equal(
    integrationCommandDedupeKey({ gatewayId: 'g1', type: 'PING', payload: { b: 2, a: 1 } }),
    integrationCommandDedupeKey({ gatewayId: 'g1', type: 'PING', payload: { a: 1, b: 2 } }),
  );
  assert.deepEqual(sanitizeIntegrationMetadata({ username: 'operator', credential: 'hidden' }), {
    username: 'operator',
  });
});

test('el backend conserva una API separada para administradores y agentes', () => {
  const app = source('backend/src/app.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  const service = source('backend/src/services/integration-gateway.service.js');
  const tables = source('backend/src/config/tables.js');

  assert.match(app, /app\.use\('\/api\/integration-gateway', integrationGatewayRouter\)/);
  assert.match(routes, /requireAdmin/);
  assert.match(routes, /USUARIOS_GESTIONAR/);
  assert.match(routes, /x-dms-gateway-id/i);
  assert.match(routes, /\/heartbeat/);
  assert.match(routes, /\/inventory/);
  assert.match(routes, /\/commands\/poll/);
  assert.match(routes, /\/commands\/result/);
  assert.match(service, /MAX_INVENTORY_ITEMS = 2_500/);
  assert.match(service, /IdempotencyKey/);
  assert.match(service, /DetectadoEnUltimaSincronizacion/);
  assert.match(tables, /IntegracionGateways/);
  assert.match(tables, /IntegracionDispositivos/);
  assert.match(tables, /IntegracionComandos/);
});

test('el agente inicial usa HTTPS saliente y un adaptador simulado reemplazable', () => {
  const client = source('gateway-agent/src/gateway-client.js');
  const runtime = source('gateway-agent/src/index.js');
  const adapter = source('gateway-agent/src/adapters/simulated.adapter.js');
  const readme = source('gateway-agent/README.md');

  assert.match(client, /Authorization/);
  assert.match(client, /X-DMS-Gateway-ID/);
  assert.match(client, /https:/);
  assert.match(runtime, /SimulatedAdapter/);
  assert.match(runtime, /heartbeat/);
  assert.match(runtime, /pollCommands/);
  assert.match(runtime, /syncInventory/);
  assert.match(adapter, /externalId/);
  assert.match(adapter, /sourceSystem: 'SIMULATED'/);
  assert.match(readme, /MilestoneInventoryAdapter/);
  assert.match(readme, /OnGuardInventoryAdapter/);
  assert.doesNotMatch(runtime, /password|rtsp:\/\//i);
});

test('la interfaz administrativa no expone el token después de provisionar', () => {
  const page = source('src/pages/admin/IntegrationsPage.jsx');
  const api = source('src/services/integrationGatewayApi.js');
  const app = source('src/app/App.jsx');
  const more = source('src/pages/MorePage.jsx');
  const styles = source('src/styles/integration-gateway.css');

  assert.match(page, /setIssuedCredential/);
  assert.match(page, /no volverá a mostrarse/);
  assert.match(page, /Ocultar token/);
  assert.match(page, /INVENTORY_SYNC/);
  assert.match(api, /\/api\/integration-gateway/);
  assert.match(api, /Authorization/);
  assert.match(app, /path="integraciones"/);
  assert.match(app, /permission="USUARIOS_GESTIONAR"/);
  assert.match(more, /to="\/integraciones"/);
  assert.match(styles, /@media \(max-width: 620px\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
});
