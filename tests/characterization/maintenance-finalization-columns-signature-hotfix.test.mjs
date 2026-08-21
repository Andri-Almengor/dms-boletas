import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la capa heredada de finalización no amplía Mantenimiento con AS:BB', () => {
  const state = source('backend/src/services/maintenance-finalization-state.service.js');
  assert.doesNotMatch(state, /import \{ ensureSheetColumns \} from '\.\/sheet-columns\.service\.js'/);
  assert.match(state, /export async function ensureMaintenanceFinalizationColumns\(\) \{\s*return MAINTENANCE_FINALIZATION_COLUMNS;\s*\}/s);
  assert.doesNotMatch(state, /ensureSheetColumns\('Mantenimiento', MAINTENANCE_FINALIZATION_COLUMNS\)/);
});

test('la firma individual ausente es opcional solo para boletas automáticas de mantenimiento', () => {
  const access = source('backend/src/modules/ticket-access.module.js');
  const tickets = source('backend/src/modules/tickets.module.js');

  assert.match(access, /requestsSignature\(ctx\.payload\) && isMaintenanceTicket\(ticket\) && !hasStoredSignatureFile\(ticket\)/);
  assert.match(access, /return optionalMaintenanceSignatureResponse\(ticket\)/);
  assert.match(access, /missing: true/);
  assert.match(access, /optional: true/);
  assert.match(access, /La firma del mantenimiento es opcional/);

  // Las boletas normales conservan la validación histórica.
  assert.match(tickets, /throw notFound\('La boleta no tiene una firma almacenada\.'\)/);
});

test('el archivo de mantenimiento sigue generando PDF sin solicitar firma por boleta', () => {
  const archive = source('backend/src/services/maintenance-ticket-archive-only.patch.js');
  assert.match(archive, /signatureRequest: null/);
  assert.match(archive, /deliveryType: 'MAINTENANCE_ARCHIVE'/);
  assert.match(archive, /FirmaSolicitada: false/);
});
