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
    `Falta el contrato de expediente de mantenimiento: ${fragment}`,
  ));
}

test('el expediente Drive usa cliente, mantenimiento, Boletas y Zonas', () => {
  const delivery = source('backend/src/services/maintenance-staged-delivery.service.js');
  includesAll(delivery, [
    "createFolder('Boletas', maintenance.id)",
    "createFolder('Zonas', maintenance.id)",
    "device.TipoDispositivo || device.Categoria || 'Tipo de dispositivo sin nombre'",
    "device.NombreDispositivo || device.EvidenciaMantenimientoID || 'Dispositivo'",
    "kind === 'ANTES' ? 'Antes' : kind === 'DESPUES' ? 'Despues' : 'Otros'",
    '`LOG - ${safe(device.NombreDispositivo || deviceId, \'Dispositivo\', 80)}.txt`',
  ]);
});

test('cada dispositivo conserva un log técnico completo y las evidencias se segmentan', () => {
  const delivery = source('backend/src/services/maintenance-staged-delivery.service.js');
  includesAll(delivery, [
    'LOG DE DISPOSITIVO - MANTENIMIENTO DMS',
    'Tipo de dispositivo:',
    'Fabricante:',
    'Modelo:',
    'Serie:',
    'Funcionamiento:',
    'En uso:',
    'Observación:',
    'CHECKLIST / RESPUESTAS',
    'EVIDENCIAS (',
    'MAINTENANCE_FINALIZATION_DRIVE_IMAGE_CHUNK',
  ]);
});

test('las boletas de mantenimiento generan PDF sin correo encuesta firma pendiente ni Chat individual', () => {
  const archive = source('backend/src/services/maintenance-ticket-archive-only.patch.js');
  includesAll(archive, [
    "deliveryType: 'MAINTENANCE_ARCHIVE'",
    'sendEmail: false',
    'survey: null',
    'signatureRequest: null',
    "EstadoNotificacion: 'OMITIDO'",
    'archiveMaintenanceTicketPdf',
    'return originalFinalize(ctx)',
    'ChatEnviado: false',
    'CorreoEnviado: false',
  ]);
  assert.doesNotMatch(archive, /sendChatMessage\(/);
});

test('todos los PDF se copian de forma idempotente a la carpeta Boletas', () => {
  const delivery = source('backend/src/services/maintenance-staged-delivery.service.js');
  includesAll(delivery, [
    'export async function archiveMaintenanceTicketPdf',
    'extractDriveFileId(pdfUrl)',
    'copyOnce(sourceId, folders.boletas.id, fileName)',
    'boletasFolderUrl',
  ]);
});

test('el Chat de finalización solo anuncia el cierre y entrega el enlace del expediente', () => {
  const delivery = source('backend/src/services/maintenance-staged-delivery.service.js');
  assert.match(delivery, /✅ Mantenimiento finalizado correctamente\./);
  assert.match(delivery, /Expediente completo: \$\{folders\.maintenance\.webViewLink\}/);
  assert.doesNotMatch(delivery, /Dispositivos procesados:/);
  assert.doesNotMatch(delivery, /Evidencias procesadas:/);
  assert.doesNotMatch(delivery, /Evidencias copiadas:/);
});

test('la finalización no obliga a ampliar Mantenimiento con columnas administrativas', () => {
  const columns = source('backend/src/services/sheet-columns.service.js');
  includesAll(columns, [
    'OPTIONAL_MAINTENANCE_FINALIZATION_COLUMNS',
    "sheetName === 'Mantenimiento'",
    'maintenanceColumnsAreOptional(sheetName, missing)',
    'missing.forEach((column) => currentKnown.add(column))',
    'MaintenanceFinalizationJobs / MaintenanceFinalizationItems',
  ]);
});

test('el parche de archivo se instala antes del worker escalonado', () => {
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');
  const archive = resume.indexOf("await import('./maintenance-ticket-archive-only.patch.js')");
  const staged = resume.indexOf("await import('./maintenance-staged-finalization.patch.js')");
  assert.ok(archive >= 0);
  assert.ok(staged > archive);
});
