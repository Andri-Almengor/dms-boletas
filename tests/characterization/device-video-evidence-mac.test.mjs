import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

function syntaxCheck(relativePath) {
  execFileSync(process.execPath, ['--check', path.join(ROOT, relativePath)], { stdio: 'pipe' });
}

test('la política común conserva 300 MB y boletas permiten videos de hasta 3 GB por bloques', () => {
  const frontend = source('src/utils/evidenceMedia.js');
  const backend = source('backend/src/services/evidence-media-policy.service.js');

  assert.match(frontend, /EVIDENCE_VIDEO_MAX_SECONDS = 90/);
  assert.match(frontend, /EVIDENCE_VIDEO_MAX_BYTES = 300 \* 1024 \* 1024/);
  assert.match(frontend, /TICKET_EVIDENCE_VIDEO_MAX_BYTES = 3 \* 1024 \* 1024 \* 1024/);
  assert.match(frontend, /readVideoDuration/);
  assert.match(frontend, /video\/quicktime/);
  assert.match(frontend, /video\/webm/);
  assert.match(backend, /EVIDENCE_VIDEO_MAX_SECONDS = 90/);
  assert.match(backend, /EVIDENCE_VIDEO_INLINE_MAX_BYTES = 30 \* 1024 \* 1024/);
  assert.match(backend, /EVIDENCE_VIDEO_MAX_BYTES = 300 \* 1024 \* 1024/);
  assert.match(backend, /TICKET_EVIDENCE_VIDEO_MAX_BYTES = 3 \* 1024 \* 1024 \* 1024/);
  assert.match(backend, /maxVideoBytes = EVIDENCE_VIDEO_MAX_BYTES/);
  assert.match(backend, /durationSeconds > EVIDENCE_VIDEO_MAX_SECONDS/);
  assert.match(backend, /Use MP4, MOV o WebM/);
});

test('boletas permiten grabar, seleccionar, validar y reproducir videos de hasta 3 GB', () => {
  const form = source('src/pages/tickets/TicketFormPage.jsx');
  const uploader = source('src/components/forms/EvidenceUploader.jsx');
  const detail = source('src/pages/tickets/TicketDetailPage.jsx');
  const multiSelect = source('src/components/forms/TicketEvidenceMultiSelectBridge.jsx');
  const preview = source('src/components/tickets/MediaPreview.jsx');
  const persistence = source('src/features/tickets/ticketPersistenceService.js');
  const batch = source('src/services/ticketEvidenceBatch.js');

  assert.match(form, /prepareEvidenceFiles\(files, \{[\s\S]*allowDocuments: true,[\s\S]*maxVideoBytes: TICKET_EVIDENCE_VIDEO_MAX_BYTES,[\s\S]*\}\)/);
  assert.match(uploader, /Grabar video/);
  assert.match(uploader, /Máximo 1 min 30 s/);
  assert.match(uploader, /pesar hasta 3 GB/);
  assert.match(uploader, /se cargan por bloques/);
  assert.match(uploader, /<video/);
  assert.match(detail, /videoInputRef/);
  assert.match(detail, /durationSeconds/);
  assert.match(detail, /Grabar video/);
  assert.match(detail, /Tomar foto/);
  assert.match(detail, /Seleccionar archivo/);
  assert.match(detail, /uploadTicketEvidenceItems/);
  assert.match(detail, /hasta 3 GB/);
  assert.match(detail, /Se cargan por partes/);
  assert.match(multiSelect, /Seleccionar varios archivos/);
  assert.match(multiSelect, /prepareEvidenceFiles\(files, \{[\s\S]*allowDocuments: true,[\s\S]*maxVideoBytes: TICKET_EVIDENCE_VIDEO_MAX_BYTES,[\s\S]*\}\)/);
  assert.match(multiSelect, /uploadTicketEvidenceItems/);
  assert.match(batch, /mediaType: item\.mediaType/);
  assert.match(batch, /durationSeconds: Number\(item\.durationSeconds/);
  assert.match(batch, /TICKET_BATCH_RESUMABLE_THRESHOLD_BYTES = LARGE_EVIDENCE_THRESHOLD_BYTES/);
  assert.doesNotMatch(multiSelect, /actionButtons\[1\]/);
  assert.doesNotMatch(multiSelect, /dmsOriginalLabel/);
  assert.match(preview, /knownKind === 'video'/);
  assert.match(preview, /<video src=\{fullSource\} controls/);
  assert.match(persistence, /uploadTicketEvidenceItems/);
  assert.match(persistence, /uploadTicketEvidenceItems/);
  assert.match(batch, /mediaType: item\.mediaType/);
  assert.match(batch, /durationSeconds: Number\(item\.durationSeconds/);
});

test('mantenimientos aceptan videos grandes en editor, carga rápida y lotes', () => {
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  const uploader = source('src/components/maintenance/MaintenanceEvidenceUploader.jsx');
  const viewer = source('src/components/maintenance/MaintenanceEvidenceImage.jsx');
  const batches = source('src/services/maintenanceImageBatch.js');

  assert.match(editor, /prepareEvidenceFiles\(files, \{[\s\S]*allowDocuments: false,[\s\S]*stabilizeTransientFiles: true,[\s\S]*\}\)/);
  assert.match(editor, /Grabar video/);
  assert.match(editor, /PendingEvidencePreview/);
  assert.match(uploader, /prepareEvidenceFiles\(selected, \{ allowDocuments: false \}\)/);
  assert.match(uploader, /1 minuto y 30 segundos/);
  assert.match(uploader, /300 MB/);
  assert.match(uploader, /uploadMaintenanceImagesInBatches/);
  assert.match(uploader, /Video ·/);
  assert.match(viewer, /kind === 'video'/);
  assert.match(viewer, /Cargando video/);
  assert.match(batches, /MAX_RAW_BYTES_PER_REQUEST = 10 \* 1024 \* 1024/);
  assert.match(batches, /MAINTENANCE_BATCH_RESUMABLE_THRESHOLD_BYTES = MAX_RAW_BYTES_PER_REQUEST/);
  assert.match(batches, /largeUploads = images\.filter/);
  assert.match(batches, /thresholdBytes: MAINTENANCE_BATCH_RESUMABLE_THRESHOLD_BYTES/);
  assert.match(batches, /uploadLargeMaintenanceEvidence/);
  assert.match(batches, /regularImages = images\.filter/);
  assert.match(batches, /mediaType: image\.mediaType/);
  assert.match(batches, /durationSeconds: Number\(image\.durationSeconds/);
  assert.match(batches, /size: Number\(image\.size/);
});

test('las evidencias grandes usan carga reanudable en bloques de 6 MiB', () => {
  const frontend = source('src/services/largeEvidenceUpload.js');
  const backend = source('backend/src/services/large-evidence-upload.service.js');
  const router = source('backend/src/core/action-router.js');
  const google = source('backend/src/infra/google.js');

  assert.doesNotThrow(() => syntaxCheck('backend/src/services/large-evidence-upload.service.js'));
  assert.match(frontend, /LARGE_EVIDENCE_THRESHOLD_BYTES = 6 \* 1024 \* 1024/);
  assert.match(frontend, /LARGE_EVIDENCE_CHUNK_BYTES = 6 \* 1024 \* 1024/);
  assert.match(frontend, /file\.slice\(offset, end/);
  assert.match(frontend, /fileToBase64\(chunk/);
  assert.match(frontend, /cargas por bloques necesitan conexión a internet/i);
  assert.match(backend, /LARGE_VIDEO_THRESHOLD_BYTES = 6 \* 1024 \* 1024/);
  assert.match(backend, /LARGE_VIDEO_MAX_BYTES = 300 \* 1024 \* 1024/);
  assert.match(backend, /TICKET_EVIDENCE_VIDEO_MAX_BYTES/);
  assert.match(backend, /validatedVideoMetadata\([\s\S]*ctx\.payload,[\s\S]*true,[\s\S]*TICKET_EVIDENCE_VIDEO_MAX_BYTES/s);
  assert.match(backend, /LARGE_VIDEO_CHUNK_BYTES = 6 \* 1024 \* 1024/);
  assert.match(backend, /uploadType=resumable/);
  assert.match(backend, /Content-Range/);
  assert.match(backend, /response\.status === 308/);
  assert.match(backend, /requireData: false/);
  assert.match(backend, /appendRow\('EvidenciasBoleta'/);
  assert.match(backend, /appendRow\('Mantenimiento imagenes'/);
  assert.match(google, /export const googleAuth = auth/);
  assert.match(router, /boletas\.evidence\.large\.init/);
  assert.match(router, /boletas\.evidence\.large\.chunk/);
  assert.match(router, /maintenance\.images\.large\.init/);
  assert.match(router, /maintenance\.images\.large\.chunk/);
  assert.match(router, /largeEvidenceUploadHandlers\.ticketInit, \['BOLETAS_EVIDENCIAS','BOLETAS_EDITAR'\]/);
  assert.match(router, /largeEvidenceUploadHandlers\.maintenanceInit, maintenanceEditPermissions/);
});

test('el flujo Base64 normal permanece limitado a 30 MB y el servidor no acepta cuerpos gigantes', () => {
  const app = source('backend/src/app.js');
  const patch = source('backend/src/services/device-media-video-mac.patch.js');

  assert.match(app, /device-media-video-mac\.patch\.js/);
  assert.match(app, /express\.json\(\{ limit: '50mb' \}\)/);
  assert.match(app, /express\.text\(\{ type: \['text\/plain', 'application\/javascript'\], limit: '50mb' \}\)/);
  assert.doesNotMatch(app, /limit: '3\d\dmb'/);
  assert.match(patch, /EVIDENCE_VIDEO_INLINE_MAX_BYTES/);
  assert.match(patch, /maxVideoBytes: EVIDENCE_VIDEO_INLINE_MAX_BYTES/);
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

  assert.doesNotThrow(() => new Function(reportScript));
  assert.match(reportScript, /MAX_EMAIL_BYTES = 18 \* 1024 \* 1024/);
  assert.match(reportScript, /grantDriveAccess: !data\.testMode/);
  assert.match(reportScript, /function grantEvidenceViewAccess_/);
  assert.match(reportScript, /file\.addViewer\(email\)/);
  assert.match(reportScript, /driveAccessGranted/);
  assert.match(reportScript, /Acceso concedido automáticamente/);
  assert.match(reportScript, /Las evidencias que excedan el tamaño seguro de adjunto/);
  assert.doesNotMatch(reportScript, /setSharing\([^)]*ANYONE/);
});

test('Apps Script no materializa ni bloquea videos grandes al enviar la boleta', () => {
  const reportScript = source('apps-script/report-service/Code.gs');

  assert.doesNotThrow(() => new Function(reportScript));
  assert.match(reportScript, /2026-10-07-V7\.14-TICKET-LARGE-VIDEO/);
  assert.match(reportScript, /const isVideo = \/\^video\\\//);
  assert.match(reportScript, /if \(isVideo && fileSize > MAX_EMAIL_BYTES\)/);
  assert.match(reportScript, /oversizedVideo: true/);
  assert.match(reportScript, /linkedVideoCount: rows\.filter/);
  assert.match(reportScript, /Video almacenado en DMS; no se adjunta al correo por su tamaño/);
  assert.match(reportScript, /allFilesAttachedDirectly: evidenceParts\.linkedVideoCount === 0/);
  assert.ok(reportScript.includes("if (!/^image\\//i.test(mimeType)) {"));
  const embedStart = reportScript.indexOf('function getDriveImageBlobForDocument_');
  const embedEnd = reportScript.indexOf('function getDriveFolderByIdWithRetry_', embedStart);
  const embedBlock = reportScript.slice(embedStart, embedEnd);
  assert.match(embedBlock, /return null;/);

  const attachmentStart = reportScript.indexOf('function buildDirectEvidenceAttachments_');
  const attachmentEnd = reportScript.indexOf('function safeAttachmentName_', attachmentStart);
  const attachmentBlock = reportScript.slice(attachmentStart, attachmentEnd);
  assert.ok(attachmentStart >= 0 && attachmentEnd > attachmentStart);
  assert.ok(
    attachmentBlock.indexOf('if (isVideo && fileSize > MAX_EMAIL_BYTES)')
      < attachmentBlock.indexOf('const blob = getDriveBlob_(fileId)'),
    'El tamaño y MIME del video deben revisarse antes de cargar el Blob completo.',
  );
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
