import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el gateway declara acciones de cámara explícitas y nunca comandos arbitrarios', () => {
  const domain = source('backend/src/services/integration-gateway.domain.js');
  for (const type of [
    'CAMERA_AUTH_TEST',
    'CAMERA_CAPABILITIES',
    'CAMERA_SNAPSHOT',
    'CAMERA_ZOOM_IN',
    'CAMERA_ZOOM_OUT',
    'CAMERA_ZOOM_STOP',
    'CAMERA_GOTO_HOME',
    'CAMERA_REBOOT',
  ]) assert.match(domain, new RegExp(`'${type}'`));
  assert.match(domain, /COMMAND_TYPES\.has\(type\)/);
});

test('las credenciales de cámara se asignan por ID y se descifran solo al entregar el comando', () => {
  const admin = source('backend/src/services/integration-device-admin.service.js');
  const execution = source('backend/src/services/integration-camera-execution.service.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  const page = source('src/pages/admin/IntegrationsPage.jsx');
  assert.match(admin, /CredencialCamaraID/);
  assert.match(admin, /no pertenece al cliente del gateway/i);
  assert.match(execution, /decryptVaultSecret/);
  assert.match(execution, /CredencialCamaraID/);
  assert.match(execution, /UNIQUE_IP_MATCH/);
  assert.match(execution, /exactIpMatches\.length === 1/);
  assert.match(execution, /Este objeto nunca se escribe en IntegracionComandos/);
  assert.match(routes, /buildCameraExecutionEnvelope/);
  assert.match(routes, /executionError/);
  assert.doesNotMatch(routes, /PasswordCiphertext|PasswordIV|PasswordTag/);
  assert.match(page, /getPasswordVaultDashboard/);
  assert.match(page, /Credencial de la cámara/);
  assert.match(page, /credentialId: editingDevice\.credentialId/);
  assert.match(page, /utilizará únicamente la credencial seleccionada/i);
});

test('el agente usa ONVIF y fallbacks de fabricante sin probar contraseñas alternativas', () => {
  const camera = source('gateway-agent/src/camera/onvif-camera-control.js');
  const router = source('gateway-agent/src/camera/camera-control-router.js');
  const physical = source('gateway-agent/src/camera/camera-physical-actions.js');
  const adapter = source('gateway-agent/src/adapters/network-discovery-identified.adapter.js');
  const envExample = source('gateway-agent/.env.example');
  assert.match(camera, /GetSnapshotUri/);
  assert.match(camera, /ContinuousMove/);
  assert.match(camera, /GotoHomePosition/);
  assert.match(camera, /SystemReboot/);
  assert.match(camera, /sameCameraUrl/);
  assert.match(camera, /Este es el único segundo intento/);
  assert.match(camera, /<tds:GetCapabilities\/>/);
  assert.match(camera, /GetServices/);
  assert.doesNotMatch(camera, /passwords|credentialList|tryPasswords/i);
  assert.match(router, /ONVIF_MEDIA2/);
  assert.match(router, /HANWHA_SUNAPI/);
  assert.match(router, /stw-cgi\/video\.cgi\?msubmenu=snapshot&action=view/);
  assert.match(router, /sameCameraUrl/);
  assert.match(physical, /PND-A7082RV/);
  assert.match(physical, /HANWHA_SUNAPI_LENS/);
  assert.match(physical, /ptzcontrol\.cgi\?msubmenu=absolute&action=control&Zoom=/);
  assert.match(physical, /Mode=SimpleFocus/);
  assert.match(physical, /OperationType=All/);
  assert.match(physical, /restoreWide/);
  assert.match(physical, /Único segundo intento/);
  assert.doesNotMatch(physical, /passwords|credentialList|tryPasswords/i);
  assert.match(adapter, /executePhysicalCameraAction/);
  assert.match(adapter, /cameraAuthFallbacks:\s*0/);
  assert.match(adapter, /CAMERA_AUTH_COOLDOWN/);
  assert.match(adapter, /DMS_CAMERA_AUTH_COOLDOWN_MS/);
  assert.match(envExample, /DMS_CAMERA_AUTH_COOLDOWN_MS=600000/);
});

test('las capturas son efímeras y la imagen no se persiste en el resultado del comando', () => {
  const snapshots = source('backend/src/services/integration-gateway-snapshot.service.js');
  const runtime = source('gateway-agent/src/index.js');
  const routes = source('backend/src/routes/integration-gateway.routes.js');
  assert.match(snapshots, /SNAPSHOT_TTL_MS = 5 \* 60_000/);
  assert.match(snapshots, /MAX_SNAPSHOT_BYTES = 3 \* 1024 \* 1024/);
  assert.doesNotMatch(snapshots, /appendRow|updateRow|sheetsApi/);
  assert.match(runtime, /uploadSnapshot/);
  assert.match(runtime, /dataBase64/);
  assert.match(runtime, /snapshotId: stored\.snapshotId/);
  assert.doesNotMatch(routes, /dataBase64.*ResultadoJSON/s);
});

test('el asistente diferencia capacidades y devuelve comandos ejecutables para las disponibles', () => {
  const formatter = source('backend/src/services/integration-gateway-answer-format.patch.js');
  assert.match(formatter, /No determinado todavía/);
  assert.match(formatter, /PTZ ONVIF/);
  assert.match(formatter, /Zoom óptico del lente/);
  assert.match(formatter, /Restaurar vista amplia\/normal/);
  assert.match(formatter, /Comandos que puede ejecutar para esta cámara/);
  assert.match(formatter, /gateway dame una captura/);
  assert.match(formatter, /gateway acercar zoom/);
  assert.match(formatter, /gateway alejar zoom/);
  assert.match(formatter, /gateway detener zoom/);
  assert.match(formatter, /gateway volver zoom a normal/);
  assert.match(formatter, /gateway reiniciar/);
  assert.match(formatter, /adaptadores compatibles del fabricante/);
});

test('el gateway entiende consultas naturales de IP puertos estado y permite renombrar por IP', () => {
  const natural = source('backend/src/services/integration-gateway-natural-language.patch.js');
  const app = source('backend/src/app.js');
  assert.match(natural, /gatewayNetworkTable/);
  assert.match(natural, /MetadataJSON/);
  assert.match(natural, /openPorts/);
  assert.match(natural, /80:\s*'HTTP'/);
  assert.match(natural, /443:\s*'HTTPS'/);
  assert.match(natural, /554:\s*'RTSP'/);
  assert.match(natural, /ONLINE/);
  assert.match(natural, /OFFLINE/);
  assert.match(natural, /updateIntegrationDeviceOperationalName/);
  assert.match(natural, /ASISTENTE_RENOMBRAR_CAMARA_GATEWAY/);
  assert.match(natural, /ponle "Nuevo nombre"/);
  assert.match(natural, /acercamela|acercala/);
  assert.match(natural, /muestrame lo que ve/);
  assert.match(natural, /vista normal/);
  assert.match(app, /integration-gateway-natural-language\.patch\.js/);
  const formatterIndex = app.indexOf("./services/integration-gateway-answer-format.patch.js");
  const naturalIndex = app.indexOf("./services/integration-gateway-natural-language.patch.js");
  assert.ok(naturalIndex > formatterIndex, 'lenguaje natural debe envolver el pipeline gateway ya formateado');
});

test('el asistente exige gateway, cliente y cámara para acciones físicas y confirma reinicios', () => {
  const assistant = source('backend/src/services/integration-gateway-assistant.patch.js');
  const credentialAssistant = source('backend/src/services/integration-gateway-credential-assistant.patch.js');
  const formatter = source('backend/src/services/integration-gateway-answer-format.patch.js');
  const app = source('backend/src/app.js');
  const maintenanceGuard = source('backend/src/services/assistant-maintenance-keyword.patch.js');
  assert.match(assistant, /GATEWAY_WORD/);
  assert.match(assistant, /Para consultas de gateway indique el nombre del cliente/);
  assert.match(assistant, /necesito la IP o el nombre de la cámara/);
  assert.match(assistant, /pendingGatewayAction/);
  assert.match(assistant, /Confirmar reinicio/);
  assert.match(assistant, /USUARIOS_GESTIONAR/);
  assert.match(credentialAssistant, /GATEWAY_CREDENTIAL_QUERY/);
  assert.match(credentialAssistant, /Esta lista no prueba ninguna contraseña/);
  assert.match(credentialAssistant, /ASIGNAR_CREDENCIAL_CAMARA_GATEWAY/);
  assert.match(formatter, /gatewayInventory/);
  assert.match(formatter, /gatewayCameraCapabilities/);
  assert.match(formatter, /Captura temporal de cámara/);
  assert.match(maintenanceGuard, /incluya la palabra “mantenimiento”/);
  const maintenanceIndex = app.indexOf("./services/assistant-maintenance-keyword.patch.js");
  const gatewayIndex = app.indexOf("./services/integration-gateway-assistant.patch.js");
  const credentialIndex = app.indexOf("./services/integration-gateway-credential-assistant.patch.js");
  const formatterIndex = app.indexOf("./services/integration-gateway-answer-format.patch.js");
  assert.ok(maintenanceIndex >= 0 && gatewayIndex > maintenanceIndex, 'gateway debe envolver al guard de mantenimiento');
  assert.ok(credentialIndex > gatewayIndex && formatterIndex > credentialIndex, 'credenciales y formato deben envolver al gateway');
});
