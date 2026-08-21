import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el backend instala la finalización escalonada antes de importar el servidor', () => {
  const pkg = JSON.parse(source('backend/package.json'));
  const bootstrap = source('backend/src/services/maintenance-finalization-router.bootstrap.js');

  assert.match(pkg.scripts.start, /--import \.\/src\/services\/maintenance-finalization-router\.bootstrap\.js\s+src\/server\.js/);
  assert.match(pkg.scripts.dev, /--import \.\/src\/services\/maintenance-finalization-router\.bootstrap\.js/);
  assert.match(pkg.scripts.check, /maintenance-finalization-router\.bootstrap\.js/);
  assert.match(bootstrap, /await import\('\.\/maintenance-finalization-resume\.patch\.js'\)/);
});

test('el worker escalonado reemplaza producción y conserva el flujo antiguo solo para modo prueba', () => {
  const staged = source('backend/src/services/maintenance-staged-finalization.patch.js');

  assert.match(staged, /maintenanceAutomationHandlers\.finalize = async \(ctx\) => \{[\s\S]*if \(testMode\(ctx\)\) return previousFinalize\(ctx\);[\s\S]*return stagedFinalize\(ctx\);/);
  assert.match(staged, /maintenanceProgressChatHandlers\.finalize = async \(ctx\) => \{[\s\S]*if \(testMode\(ctx\)\) return previousFinalize\(ctx\);[\s\S]*return stagedFinalize\(ctx\);/);
  assert.match(staged, /processStagedTicketItem\(ctx, id, item\.ReferenciaID\)/);
});

test('las boletas escalonadas respetan límites de evidencias antes de Apps Script', () => {
  const splitter = source('backend/src/services/maintenance-fast-ticket-generation.service.js');
  const stagedTicket = source('backend/src/services/maintenance-staged-ticket.service.js');

  assert.match(splitter, /MAINTENANCE_TICKET_MAX_EVIDENCES/);
  assert.match(splitter, /chunkArray\(deviceImages\.get\(deviceId\) \|\| \[\], limits\.maxEvidences\)/);
  assert.match(splitter, /nextEvidenceCount > limits\.maxEvidences/);
  assert.match(stagedTicket, /buildMaintenanceTicketGroups\(bundle\)\.find/);
  assert.match(stagedTicket, /ticketDeliveryHandlers\.finalize/);
});
