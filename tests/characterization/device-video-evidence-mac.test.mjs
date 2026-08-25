import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('la política común permite videos de hasta 90 segundos y 30 MB', () => {
  const frontend = source('src/utils/evidenceMedia.js');
  const backend = source('backend/src/services/evidence-media-policy.service.js');

  assert.match(frontend, /EVIDENCE_VIDEO_MAX_SECONDS = 90/);
  assert.match(frontend, /EVIDENCE_VIDEO_MAX_BYTES = 30 \* 1024 \* 1024/);
  assert.match(frontend, /readVideoDuration/);
  assert.match(frontend, /video\/quicktime/);
  assert.match(frontend, /video\/webm/);
  assert.match(backend, /EVIDENCE_VIDEO_MAX_SECONDS = 90/);
  assert.match(backend, /EVIDENCE_VIDEO_MAX_BYTES = 30 \* 1024 \* 1024/);
  assert.match(backend, /durationSeconds > EVIDENCE_VIDEO_MAX_SECONDS/);
  assert.match(backend, /Use MP4, MOV o WebM/);
});

test('boletas permiten grabar, seleccionar, validar y reproducir videos', () => {
  const form = source('src/pages/tickets/TicketFormPage.jsx');
  const uploader = source('src/components/forms/EvidenceUploader.jsx');
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const multiSelect = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');
  const preview = source('src/components/tickets/MediaPreview.jsx');
  const persistence = source('src/features/tickets/ticketPersistenceService.js');

  assert.match(form, /prepareEvidenceFiles\(files, \{ allowDocuments: true \}\)/);
  assert.match(uploader, /Grabar video/);
  assert.match(uploader, /Máximo 1 min 30 s/);
  assert.match(uploader, /pesar hasta 30 MB/);
  assert.match(uploader, /<video/);
  assert.match(detail, /videoInputRef/);
  assert.match(detail, /durationSeconds/);
  assert.match(detail, /Grabar video/);
  assert.match(detail, /Tomar foto/);
  assert.match(detail, /Seleccionar archivo/);
  assert.match(multiSelect, /Seleccionar varios archivos/);
  assert.match(multiSelect, /prepareEvidenceFiles\(files, \{ allowDocuments: true \}\)/);
  assert.match(multiSelect, /mediaType: prepared\.mediaType/);
  assert.match(multiSelect, /durationSeconds: Number\(prepared\.durationSeconds/);
  assert.doesNotMatch(multiSelect, /actionButtons\[1\]/);
  assert.doesNotMatch(multiSelect, /dmsOriginalLabel/);
  assert.match(preview, /resolvedKind === 'video'/);
  assert.match(preview, /<video src=\{source\} controls/);
  assert.match(persistence, /mediaType: item\.mediaType/);
  assert.match(persistence, /durationSeconds: Number\(item\.durationSeconds/);
});

test('mantenimientos aceptan videos en editor, carga rápida y lotes', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const viewer = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');
  const batches = source('src/services/maintenanceImageBatch.js');

  assert.match(editor, /prepareEvidenceFiles\(files, \{ allowDocuments: false \}\)/);
  assert.match(editor, /Grabar video/);
  assert.match(editor, /PendingEvidencePreview/);
  assert.match(uploader, /prepareEvidenceFiles\(selected, \{ allowDocuments: false \}\)/);
  assert.match(uploader, /1 minuto y 30 segundos/);
  assert.match(uploader, /30 MB/);
  assert.match(uploader, /Video ·/);
  assert.match(viewer, /kind === 'video'/);
  assert.match(viewer, /Cargando video/);
  assert.match(batches, /MAX_RAW_BYTES_PER_REQUEST = 10 \* 1024 \* 1024/);
  assert.match(batches, /mediaType: image\.mediaType/);
  assert.match(batches, /durationSeconds: Number\(image\.durationSeconds/);
  assert.match(batches, /size: Number\(image\.size/);
});

test('el backend valida videos y admite el Base64 de un archivo de 30 MB', () => {
  const app = source('backend/src/app.js');
  const patch = source('backend/src/services/device-media-video-mac.patch.js');

  assert.match(app, /device-media-video-mac\.patch\.js/);
  assert.match(app, /express\.json\(\{ limit: '50mb' \}\)/);
  assert.match(app, /express\.text\(\{ type: \['text\/plain', 'application\/javascript'\], limit: '50mb' \}\)/);
  assert.match(patch, /validateEvidenceMediaPayload/);
  assert.match(patch, /ticketMultiHandlers\.evidenceUpload/);
  assert.match(patch, /maintenanceDynamicQuestionHandlers\.imageUpload/);
  assert.match(patch, /maintenanceScalableImageHandlers\.uploadBatch/);
  assert.match(patch, /videoMaxSeconds: 90/);
  assert.match(patch, /TipoMedio/);
  assert.match(patch, /DuracionSegundos/);
  assert.match(patch, /TamanoBytes/);
});

test('videos de boletas y mantenimientos conservan el flujo hacia correo', () => {
  const appsScriptTicket = source('backend/src/services/apps-script-ticket.service.js');
  const maintenanceTickets = source('backend/src/services/maintenance-fast-ticket-generation.service.js');
  const delivery = source('backend/src/services/ticket-delivery.service.js');

  assert.match(appsScriptTicket, /evidences: bundle\.evidences/);
  assert.match(delivery, /generateTicketWithAppsScript/);
  assert.match(maintenanceTickets, /ArchivoID: clean\(image\.DriveFileID\)/);
  assert.match(maintenanceTickets, /MimeType: clean\(image\.MimeType/);
  assert.match(maintenanceTickets, /ticketDeliveryHandlers\.finalize/);
});

test('Apps Script adjunta lo que cabe y concede acceso directo a evidencias grandes', () => {
  const reportScript = source('apps-script/boletas-report/Code.gs');

  assert.match(reportScript, /MAX_EMAIL_BYTES = 18 \* 1024 \* 1024/);
  assert.match(reportScript, /grantDriveAccess: !data\.testMode/);
  assert.match(reportScript, /function grantEvidenceViewAccess_/);
  assert.match(reportScript, /file\.addViewer\(email\)/);
  assert.match(reportScript, /driveAccessGranted/);
  assert.match(reportScript, /Acceso concedido automáticamente/);
  assert.match(reportScript, /Las evidencias que excedan el tamaño seguro de adjunto/);
  assert.doesNotMatch(reportScript, /setSharing\([^)]*ANYONE/);
});

test('las presentaciones incrustan imágenes y conservan videos como enlaces separados', () => {
  const presentation = source('backend/src/services/maintenance-presentation.service.js');

  assert.match(presentation, /function isVideoEvidence/);
  assert.match(presentation, /Imagenes: evidence\.filter\(\(item\) => !isVideoEvidence\(item\)\)/);
  assert.match(presentation, /Videos: evidence\.filter\(isVideoEvidence\)/);
  assert.match(presentation, /DireccionMAC/);
});

test('boletas y dispositivos de mantenimiento guardan Dirección MAC normalizada', () => {
  const mac = source('src/utils/macAddress.js');
  const ticketDomain = source('src/features/tickets/ticketFormDomain.js');
  const ticketForm = source('src/pages/tickets/TicketFormPage.jsx');
  const maintenanceData = source('src/pages/maintenance/maintenanceFormData.js');
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const patch = source('backend/src/services/device-media-video-mac.patch.js');

  assert.match(mac, /AA:BB:CC:DD:EE:FF/);
  assert.match(ticketDomain, /DireccionMAC: macAddress/);
  assert.match(ticketForm, /label="Dirección MAC"/);
  assert.match(maintenanceData, /DireccionMAC: macAddress/);
  assert.match(editor, /label="Dirección MAC"/);
  assert.match(patch, /ensureSheetColumns\('Boletas', MAC_COLUMNS\)/);
  assert.match(patch, /ensureSheetColumns\('Evidencia_Mantenimientos', MAC_COLUMNS\)/);
});

test('la finalización normal no muestra una alerta de disponibilidad', () => {
  const center = source('src/components/offline/MaintenanceFinalizationCenter.jsx');
  const styles = source('src/components/offline/MaintenanceFinalizationCenter.css');

  assert.doesNotMatch(center, />Finalización disponible</);
  assert.match(center, /createPortal/);
  assert.match(center, /maintenance-finalize-footer-button/);
  assert.match(center, /const showStatus = Boolean/);
  assert.match(center, /view\.active \|\| message/);
  assert.match(styles, /button\.button--primary:first-child:not\(\.maintenance-finalize-footer-button\)/);
  assert.match(styles, /display:\s*none/);
});
