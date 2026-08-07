import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el asistente conserva y renderiza la captura temporal devuelta por gateway', () => {
  const assistant = source('src/pages/assistant/AssistantPageSecure.jsx');
  const component = source('src/components/assistant/GatewaySnapshotCard.jsx');
  const snapshots = source('backend/src/services/integration-gateway-snapshot.service.js');

  assert.match(assistant, /GatewaySnapshotCard/);
  assert.match(assistant, /snapshot:\s*response\.facts\?\.gatewaySnapshot\s*\|\|\s*null/);
  assert.match(assistant, /message\.snapshot\s*&&\s*<GatewaySnapshotCard/);
  assert.match(component, /<img/);
  assert.match(component, /src=\{snapshot\.url\}/);
  assert.match(component, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(component, /target="_blank"/);
  assert.match(snapshots, /\/api\/integration-gateway\/snapshots\/\$\{encodeURIComponent\(snapshot\.snapshotId\)\}/);
});

test('las capturas siguen tratándose como contenido sensible y efímero', () => {
  const assistant = source('src/pages/assistant/AssistantPageSecure.jsx');
  const component = source('src/components/assistant/GatewaySnapshotCard.jsx');
  assert.match(assistant, /Esta respuesta contiene información sensible/);
  assert.match(assistant, /messages\.filter\(\(item\) => !item\.sensitive\)/);
  assert.match(component, /La imagen no se guarda en el historial y expira automáticamente/);
});
