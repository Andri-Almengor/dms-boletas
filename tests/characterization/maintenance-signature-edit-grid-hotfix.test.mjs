import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el hotfix se instala antes de capturar el finalize heredado del reporte', () => {
  const resume = source('backend/src/services/maintenance-finalization-resume.patch.js');
  const hotfix = resume.indexOf("await import('./maintenance-grid-signature-hotfix.patch.js')");
  const capture = resume.indexOf('const finalizeDelivery = maintenanceReportAccessHandlers.finalize');
  assert.ok(hotfix >= 0);
  assert.ok(capture > hotfix);
});

test('la finalización del reporte no vuelve a escribir AS:BB ni a crecer Mantenimiento', () => {
  const hotfix = source('backend/src/services/maintenance-grid-signature-hotfix.patch.js');
  assert.match(hotfix, /maintenanceReportAccessHandlers\.finalize = finalizeWithoutGrowingMaintenanceGrid/);
  assert.match(hotfix, /No se crean columnas nuevas aquí/);
  assert.doesNotMatch(hotfix, /ensureDeliveryColumns/);
  assert.doesNotMatch(hotfix, /spreadsheets\.values\.update/);
});

test('la firma existente puede recuperarse de FirmaMantenimientoSolicitudes y rehidratar Mantenimiento', () => {
  const signatures = source('backend/src/services/maintenance-signature-state.service.js');
  assert.match(signatures, /const REQUEST_SHEET = 'FirmaMantenimientoSolicitudes'/);
  assert.match(signatures, /clean\(row\.Estado\)\.toUpperCase\(\) === 'FIRMADA'/);
  assert.match(signatures, /FirmaOrigen: 'RECUPERADA_SOLICITUD_MANTENIMIENTO'/);
  assert.match(signatures, /downloadAsDataUrl/);
  assert.match(signatures, /extractDriveFileId/);
});

test('editar la firma reemplaza el archivo y sincroniza las boletas relacionadas', () => {
  const signatures = source('backend/src/services/maintenance-signature-state.service.js');
  const hotfix = source('backend/src/services/maintenance-grid-signature-hotfix.patch.js');
  assert.match(signatures, /export async function replaceMaintenanceSignature/);
  assert.match(signatures, /synchronizeMaintenanceSignatureToTickets/);
  assert.match(hotfix, /EDITAR_FIRMA_MANTENIMIENTO/);
  assert.match(hotfix, /No tiene permiso para editar la firma del mantenimiento/);
});

test('la tarjeta de mantenimiento muestra la firma real y permite reemplazarla', () => {
  const card = source('src/components/maintenance/MaintenanceSignatureCard.jsx');
  assert.match(card, /import SignaturePad from '\.\.\/tickets\/SignaturePad'/);
  assert.match(card, /Editar \/ reemplazar firma/);
  assert.match(card, /signature\.dataUrl/);
  assert.match(card, /base64: signatureDraft\.split\(','\)\[1\]/);
  assert.match(card, /Guardar nueva firma/);
});
