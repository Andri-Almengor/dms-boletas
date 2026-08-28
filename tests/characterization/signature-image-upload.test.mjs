import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('el editor compartido permite dibujar o cargar una imagen de firma', () => {
  const signaturePad = source('src/components/tickets/SignaturePad.jsx');

  assert.match(signaturePad, /Cargar imagen/);
  assert.match(signaturePad, /accept="image\/\*/);
  assert.match(signaturePad, /MAX_SIGNATURE_SOURCE_BYTES/);
  assert.match(signaturePad, /canvas\.toDataURL\('image\/png'\)/);
  assert.match(signaturePad, /La imagen se adapta automáticamente al recuadro de firma/);
});

test('las boletas conservan su ruta actual de firma y reciben la mejora desde SignaturePad', () => {
  const ticketDetail = source('src/pages/tickets/TicketDetailPage.jsx');
  const moduleApi = source('src/services/moduleApi.js');

  assert.match(ticketDetail, /<SignaturePad value=\{signatureDraft\} onChange=\{setSignatureDraft\}/);
  assert.match(ticketDetail, /MODULE_ROUTES\.tickets\.signatureUpload/);
  assert.match(moduleApi, /signatureUpload: \['boletas\.signature\.upload'\]/);
});

test('mantenimiento permite registrar directamente la imagen usando el flujo público existente', () => {
  const card = source('src/components/maintenance/MaintenanceSignatureCard.jsx');
  const router = source('backend/src/core/action-router.js');
  const signatureService = source('backend/src/services/maintenance-signature-request.service.js');

  assert.match(card, /SignaturePad/);
  assert.match(card, /maintenance\.signature\.public\.submit/);
  assert.match(card, /mantenimientos\.firma\.publica\.guardar/);
  assert.match(card, /Usar esta firma/);
  assert.match(card, /mimeType: 'image\/png'/);
  assert.match(router, /maintenance\.signature\.public\.submit/);
  assert.match(signatureService, /synchronizeMaintenanceSignatureToTickets/);
  assert.match(signatureService, /FirmaOrigen: 'ENLACE_CLIENTE_MANTENIMIENTO'/);
});

test('la firma por enlace permanece disponible junto con la carga directa', () => {
  const card = source('src/components/maintenance/MaintenanceSignatureCard.jsx');

  assert.match(card, /Copiar enlace/);
  assert.match(card, /Compartir con cliente/);
  assert.match(card, /Abrir enlace real/);
  assert.match(card, /Probar firma sin guardar/);
});
