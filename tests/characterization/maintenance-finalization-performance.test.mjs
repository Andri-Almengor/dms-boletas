import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function includesAll(contents, fragments) {
  fragments.forEach((fragment) => assert.ok(
    contents.includes(fragment),
    `Falta el contrato de rendimiento: ${fragment}`,
  ));
}

test('la generación optimizada evita escrituras una por una y protege el límite de Sheets', () => {
  const contents = source('backend/src/services/maintenance-fast-ticket-generation.service.js');
  includesAll(contents, [
    'MAINTENANCE_TICKET_SAFE_CELL_CHARS = 40_000',
    'const DELIVERY_CONCURRENCY = 1;',
    'appendRows(',
    'updateRows(',
    'fitMaintenanceTicketCell(draft.pruebasRealizadas)',
    'fitMaintenanceTicketCell(draft.resultado)',
    'fitMaintenanceTicketCell(draft.recomendaciones)',
    'if (safeMax <= suffix.length) return text.slice(0, safeMax);',
  ]);
  assert.equal(
    contents.includes('rewriteTechnicalReport'),
    false,
    'la finalización no debe esperar Gemini para cada grupo de mantenimiento',
  );
  assert.equal(
    contents.includes('await appendRow(\'EvidenciasBoleta\''),
    false,
    'las evidencias automáticas deben persistirse en lotes',
  );
});

test('la entrega de Drive usa concurrencia limitada y reutiliza carpetas compartidas', () => {
  const contents = source('backend/src/services/maintenance-fast-delivery.service.js');
  includesAll(contents, [
    'const DEVICE_CONCURRENCY = 3;',
    'const IMAGE_COPY_CONCURRENCY = 3;',
    'const promises = new Map();',
    'const processed = await concurrentMap(',
    'bundle.devices,',
    'DEVICE_CONCURRENCY,',
    'imagesByDevice',
    'notificationState: chatError || dest.skipped ? \'ERROR\' : \'ENVIADO\'',
  ]);
  assert.match(
    contents,
    /El Chat es una notificación secundaria/,
    'un error de Chat no debe invalidar todo el trabajo de finalización',
  );
});

test('el camino de producción conserva reanudación persistente y usa los servicios optimizados', () => {
  const performance = source('backend/src/services/maintenance-finalization-performance.patch.js');
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');
  includesAll(performance, [
    'runResumableMaintenanceFinalization',
    'generateMaintenanceTicketsFast',
    'deliverMaintenanceFast',
    "await tracker.mark('GENERANDO_BOLETAS')",
    "await tracker.mark('ENTREGANDO'",
    "Estado: 'FINALIZADO'",
  ]);
  assert.match(resume, /maintenance-finalization-performance\.patch\.js/);
});
