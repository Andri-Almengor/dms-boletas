import { AppError } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { findById, updateRow } from '../infra/sheets.repository.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { ticketDeliveryHandlers } from '../modules/ticket-delivery.module.js';
import { audit } from './audit.service.js';
import {
  createFinalizationJob,
  ensureFinalizationItems,
  ensureMaintenanceFinalizationStorage,
  findFinalizationJobForMaintenance,
  getFinalizationJob,
  listFinalizationItems,
  progressForSummary,
  summarizeFinalizationItems,
  updateFinalizationItem,
  updateFinalizationItems,
  updateFinalizationJob,
} from './maintenance-finalization-job.storage.js';
import { maintenanceHasSignature } from './maintenance-signature-request.service.js';
import { ensureMaintenanceQuestionsReady } from './maintenance-question-bootstrap.service.js';
import { prepareStagedTicketPlan, processStagedTicketItem } from './maintenance-staged-ticket.service.js';
import {
  finalizeStagedMaintenanceDelivery,
  prepareStagedDrivePlan,
  processStagedDriveItem,
} from './maintenance-staged-delivery.service.js';
import { ensureSheetColumns } from './sheet-columns.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceStagedFinalization');
const ROUTER_FLAG = Symbol.for('dms.maintenanceStagedFinalization.router');
const GET_FLAG = Symbol.for('dms.maintenanceStagedFinalization.get');

const PROGRESS_COLUMNS = [
  'EstadoFinalizacion',
  'PasoFinalizacion',
  'FinalizacionSolicitudID',
  'FinalizacionIntentos',
  'FinalizacionSolicitadaEn',
  'FinalizacionIniciadaEn',
  'FinalizacionActualizadaEn',
  'FinalizacionCompletadaEn',
  'FinalizacionSolicitadaPor',
  'UltimoErrorFinalizacion',
  'FinalizacionJobID',
  'FinalizacionProgreso',
  'FinalizacionTotalBoletas',
  'FinalizacionBoletasCompletadas',
  'FinalizacionTotalDispositivos',
  'FinalizacionDispositivosCompletados',
  'FinalizacionTotalEvidencias',
  'FinalizacionEvidenciasProcesadas',
  'FinalizacionMensaje',
  'FirmaEstadoFinalizacion',
  'FirmaOmitidaAlFinalizar',
];

const DELIVERY_COLUMNS = [
  'CarpetaDriveID',
  'CarpetaDriveURL',
  'EstadoNotificacion',
  'ChatDestino',
  'ChatEnviadoEn',
  'ChatFallbackPruebas',
  'ImagenesEsperadas',
  'ImagenesCopiadas',
  'ImagenesYaExistentes',
  'ErroresCopia',
  'BoletasGeneradasJSON',
  'BoletasGeneradasCantidad',
  'BoletasGeneradasEn',
  'EstadoBoletasMantenimiento',
  'UltimoErrorBoletasMantenimiento',
];

function clean(value) { return String(value ?? '').trim(); }
function boolean(value) {
  return value === true || ['true', '1', 'si', 'sí', 'yes'].includes(clean(value).toLowerCase());
}
function positiveEnvInteger(name, fallback, minimum = 1, maximum = 100) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function maintenanceId(ctx) { return clean(pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id'])); }
function testMode(ctx) { return Boolean(ctx.payload?.testMode || ctx.payload?.prueba); }
function retryRequested(ctx) { return boolean(pick(ctx.payload, ['retryFinalization', 'reintentarFinalizacion'], false)); }

const AUTO_RETRY_MAX = positiveEnvInteger('MAINTENANCE_FINALIZATION_AUTO_RETRY_MAX', 3, 1, 10);
const DRIVE_ITEMS_PER_STEP = positiveEnvInteger('MAINTENANCE_FINALIZATION_DRIVE_ITEMS_PER_STEP', 2, 1, 10);
const DRIVE_MAX_IMAGES_PER_STEP = positiveEnvInteger('MAINTENANCE_FINALIZATION_DRIVE_MAX_IMAGES_PER_STEP', 30, 1, 100);
const WORKER_DELAY_MS = positiveEnvInteger('MAINTENANCE_FINALIZATION_WORKER_DELAY_MS', 500, 100, 10_000);

const scheduledJobs = new Map();
let schedulerPromise = null;

function safeCell(value, max = 40_000) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 18)}\n[Contenido truncado]`;
}

function phaseToStep(phase) {
  const value = clean(phase).toUpperCase();
  if (value === 'BOLETAS') return 'GENERANDO_BOLETAS';
  if (value === 'DRIVE') return 'ENTREGANDO';
  if (value === 'CIERRE') return 'COMPLETANDO';
  if (value === 'COMPLETADO') return 'COMPLETADO';
  return 'VALIDANDO';
}

function progressMessage(summary, phase) {
  const normalized = clean(phase).toUpperCase();
  if (normalized === 'PREPARANDO') return 'Preparando el plan de finalización escalonada...';
  if (normalized === 'BOLETAS') {
    return `Generando boletas: ${summary.completedTickets} de ${summary.totalTickets}.`;
  }
  if (normalized === 'DRIVE') {
    return `Organizando Drive: ${summary.completedDevices} de ${summary.totalDevices} dispositivos · ${summary.processedEvidences} de ${summary.totalEvidences} evidencias.`;
  }
  if (normalized === 'CIERRE') return 'Confirmando el cierre, el registro y la notificación final.';
  if (normalized === 'COMPLETADO') return 'Mantenimiento finalizado correctamente.';
  return 'Finalización en proceso.';
}

function isTransient(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const code = clean(error?.code).toUpperCase();
  if ([
    'APPS_SCRIPT_TIMEOUT',
    'SERVER_BUSY',
    'SERVER_BUSY_TIMEOUT',
    'SHEETS_QUOTA_EXCEEDED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'UND_ERR_HEADERS_TIMEOUT',
  ].includes(code)) return true;
  const message = clean(error?.message).toLowerCase();
  return message.includes('timeout')
    || message.includes('temporarily unavailable')
    || message.includes('rate limit')
    || message.includes('backend error')
    || message.includes('fetch failed');
}

async function ensureProgressStorage() {
  await Promise.all([
    ensureMaintenanceFinalizationStorage(),
    ensureSheetColumns('Mantenimiento', [...PROGRESS_COLUMNS, ...DELIVERY_COLUMNS]),
  ]);
}

async function persistProgress(ctx, maintenanceIdValue, job, items, phase = job.Fase, patch = {}) {
  const summary = summarizeFinalizationItems(items);
  const progress = progressForSummary(summary, phase);
  const step = phaseToStep(phase);
  const message = progressMessage(summary, phase);
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const timestamp = nowIso();
  await updateFinalizationJob(job.JobID, {
    Estado: 'EN_PROCESO',
    Fase: phase,
    TotalBoletas: summary.totalTickets,
    BoletasCompletadas: summary.completedTickets,
    TotalDispositivos: summary.totalDevices,
    DispositivosCompletados: summary.completedDevices,
    TotalEvidencias: summary.totalEvidences,
    EvidenciasProcesadas: summary.processedEvidences,
    Porcentaje: progress,
    UltimoError: '',
    ActualizadoPor: actor,
    ...patch.job,
  });
  await updateRow('Mantenimiento', maintenanceIdValue, {
    EstadoFinalizacion: 'EN_PROCESO',
    PasoFinalizacion: step,
    FinalizacionJobID: job.JobID,
    FinalizacionProgreso: progress,
    FinalizacionTotalBoletas: summary.totalTickets,
    FinalizacionBoletasCompletadas: summary.completedTickets,
    FinalizacionTotalDispositivos: summary.totalDevices,
    FinalizacionDispositivosCompletados: summary.completedDevices,
    FinalizacionTotalEvidencias: summary.totalEvidences,
    FinalizacionEvidenciasProcesadas: summary.processedEvidences,
    FinalizacionMensaje: message,
    FinalizacionActualizadaEn: timestamp,
    UltimoErrorFinalizacion: '',
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
    ...patch.maintenance,
  });
  return { summary, progress, step, message };
}

async function markJobError(ctx, maintenanceIdValue, job, error) {
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const message = safeCell(clean(error?.message || error), 1500);
  const timestamp = nowIso();
  await updateFinalizationJob(job.JobID, {
    Estado: 'ERROR',
    UltimoError: message,
    ActualizadoPor: actor,
  }).catch(() => {});
  await updateRow('Mantenimiento', maintenanceIdValue, {
    EstadoFinalizacion: 'ERROR',
    PasoFinalizacion: phaseToStep(job.Fase),
    FinalizacionJobID: job.JobID,
    FinalizacionActualizadaEn: timestamp,
    FinalizacionMensaje: 'La finalización se detuvo en una unidad concreta y puede reanudarse desde ese punto.',
    UltimoErrorFinalizacion: message,
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
  }).catch(() => {});
}

async function resetErroredItems(jobId, actor) {
  const items = await listFinalizationItems(jobId);
  const reset = items
    .filter((item) => ['ERROR', 'EN_PROCESO'].includes(clean(item.Estado).toUpperCase()))
    .map((item) => ({
      itemId: item.ItemID,
      patch: {
        Estado: 'PENDIENTE',
        UltimoError: '',
        ActualizadoPor: actor,
      },
    }));
  if (reset.length) await updateFinalizationItems(reset);
}

async function startOrResumeJob(ctx, id) {
  await ensureProgressStorage();
  const row = await findById('Mantenimiento', id);
  if (clean(row.Estado).toUpperCase() === 'FINALIZADO') {
    return { completed: true, row, job: await findFinalizationJobForMaintenance(id, row.FinalizacionJobID).catch(() => null) };
  }

  let job = await findFinalizationJobForMaintenance(id, row.FinalizacionJobID);
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const retry = retryRequested(ctx);
  if (job && clean(job.Estado).toUpperCase() === 'COMPLETADO') job = null;

  if (!job) {
    job = await createFinalizationJob({ maintenanceId: id, actor });
    const timestamp = nowIso();
    await updateRow('Mantenimiento', id, {
      EstadoFinalizacion: 'EN_PROCESO',
      PasoFinalizacion: 'VALIDANDO',
      FinalizacionJobID: job.JobID,
      FinalizacionSolicitudID: clean(ctx.payload?.finalizationRequestId) || `finalize-${id}`,
      FinalizacionIntentos: Number(row.FinalizacionIntentos || 0) + 1,
      FinalizacionSolicitadaEn: row.FinalizacionSolicitadaEn || timestamp,
      FinalizacionIniciadaEn: timestamp,
      FinalizacionActualizadaEn: timestamp,
      FinalizacionSolicitadaPor: actor,
      FinalizacionProgreso: 2,
      FinalizacionMensaje: 'Preparando el plan de finalización escalonada...',
      UltimoErrorFinalizacion: '',
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
    return { completed: false, row, job };
  }

  if (clean(job.Estado).toUpperCase() === 'ERROR') {
    if (!retry) return { completed: false, row, job, error: true };
    await resetErroredItems(job.JobID, actor);
    job = await updateFinalizationJob(job.JobID, {
      Estado: 'EN_PROCESO',
      UltimoError: '',
      Reintentos: Number(job.Reintentos || 0) + 1,
      ActualizadoPor: actor,
    });
  }

  await updateRow('Mantenimiento', id, {
    EstadoFinalizacion: 'EN_PROCESO',
    FinalizacionJobID: job.JobID,
    UltimoErrorFinalizacion: '',
    FinalizacionMensaje: clean(row.FinalizacionMensaje) || 'Reanudando la finalización escalonada...',
    FinalizacionActualizadaEn: nowIso(),
    ActualizadoPor: actor,
    FechaActualizacion: nowIso(),
  });
  return { completed: false, row, job };
}

async function prepareJob(ctx, id, job) {
  const [ticketPlan, drivePlan] = await Promise.all([
    prepareStagedTicketPlan(id),
    prepareStagedDrivePlan(id),
  ]);
  const ticketDefinitions = ticketPlan.groups.map((group) => ({
    type: 'TICKET',
    referenceId: group.key,
    order: group.order,
    part: group.partIndex,
    totalParts: group.partCount,
    evidences: group.evidenceCount,
  }));
  const driveDefinitions = drivePlan.items.map((item) => ({
    ...item,
    order: ticketDefinitions.length + item.order,
  }));
  const items = await ensureFinalizationItems(
    job,
    [...ticketDefinitions, ...driveDefinitions],
    ctx.user?.UsuarioID || 'SISTEMA',
  );
  await persistProgress(ctx, id, job, items, 'BOLETAS');
  return { continue: true };
}

async function processTicketStep(ctx, id, job, items) {
  const summary = summarizeFinalizationItems(items);
  const item = summary.pendingTickets[0];
  if (!item) return { phaseComplete: true };
  const attempts = Number(item.Intentos || 0) + 1;
  await updateFinalizationItem(item.ItemID, {
    Estado: 'EN_PROCESO',
    Intentos: attempts,
    FechaInicio: item.FechaInicio || nowIso(),
    UltimoError: '',
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
  });

  try {
    const result = await processStagedTicketItem(ctx, id, item.ReferenciaID);
    const maintenance = await findById('Mantenimiento', id);
    if (result.reused && maintenanceHasSignature(maintenance)) {
      const report = await ticketDeliveryHandlers.generatePdf({
        ...ctx,
        permissions: [...new Set([...(ctx.permissions || []), 'USUARIOS_GESTIONAR', 'BOLETAS_VER', 'BOLETAS_EDITAR'])],
        payload: { boletaUid: result.ticketId, BoletaUID: result.ticketId, id: result.ticketId },
      });
      result.pdfUrl = result.pdfUrl || report?.pdfUrl || '';
    }
    await updateFinalizationItem(item.ItemID, {
      Estado: 'COMPLETADO',
      ResultadoID: result.ticketId,
      ResultadoURL: result.pdfUrl || '',
      UltimoError: '',
      FechaFinalizacion: nowIso(),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    });
    const refreshed = await listFinalizationItems(job.JobID);
    await persistProgress(ctx, id, job, refreshed, 'BOLETAS');
    return { continue: true };
  } catch (error) {
    const transient = isTransient(error);
    if (transient && attempts < AUTO_RETRY_MAX) {
      await updateFinalizationItem(item.ItemID, {
        Estado: 'PENDIENTE',
        UltimoError: safeCell(clean(error?.message || error), 1500),
        ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
      });
      return { continue: true, retryDelay: Math.min(10_000, attempts * 2_000) };
    }
    await updateFinalizationItem(item.ItemID, {
      Estado: 'ERROR',
      UltimoError: safeCell(clean(error?.message || error), 1500),
      ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    });
    await markJobError(ctx, id, job, error);
    return { error: true };
  }
}

async function finishTicketPhase(ctx, id, job, items) {
  const summary = summarizeFinalizationItems(items);
  const ticketIds = summary.tickets.map((item) => clean(item.ResultadoID)).filter(Boolean);
  const timestamp = nowIso();
  await updateRow('Mantenimiento', id, {
    BoletasGeneradasJSON: JSON.stringify(ticketIds),
    BoletasGeneradasCantidad: ticketIds.length,
    BoletasGeneradasEn: timestamp,
    EstadoBoletasMantenimiento: 'GENERADAS_Y_ENVIADAS',
    UltimoErrorBoletasMantenimiento: '',
    ActualizadoPor: ctx.user?.UsuarioID || 'SISTEMA',
    FechaActualizacion: timestamp,
  });
  await persistProgress(ctx, id, job, items, 'DRIVE', {
    maintenance: { EstadoNotificacion: 'ENVIANDO' },
  });
}

function selectDriveBatch(summary) {
  const candidates = summary.pendingDrive
    .filter((item) => clean(item.Estado).toUpperCase() !== 'ERROR')
    .sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
  const selected = [];
  let images = 0;
  for (const item of candidates) {
    const itemImages = Number(item.Evidencias || 0);
    if (selected.length >= DRIVE_ITEMS_PER_STEP) break;
    if (selected.length && images + itemImages > DRIVE_MAX_IMAGES_PER_STEP) break;
    selected.push(item);
    images += itemImages;
  }
  return selected;
}

async function processDriveStep(ctx, id, job, items) {
  const summary = summarizeFinalizationItems(items);
  const selected = selectDriveBatch(summary);
  if (!selected.length) return { phaseComplete: true };
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  await updateFinalizationItems(selected.map((item) => ({
    itemId: item.ItemID,
    patch: {
      Estado: 'EN_PROCESO',
      Intentos: Number(item.Intentos || 0) + 1,
      FechaInicio: item.FechaInicio || nowIso(),
      UltimoError: '',
      ActualizadoPor: actor,
    },
  })));

  let hardError = null;
  const results = [];
  for (const item of selected) {
    const attempts = Number(item.Intentos || 0) + 1;
    try {
      const result = await processStagedDriveItem(ctx, id, item);
      results.push({
        itemId: item.ItemID,
        patch: {
          Estado: 'COMPLETADO',
          ResultadoID: result.folderId || '',
          ResultadoURL: result.folderUrl || '',
          Copiadas: result.copied,
          Existentes: result.skipped,
          UltimoError: safeCell(result.errors.join(' | '), 1500),
          FechaFinalizacion: nowIso(),
          ActualizadoPor: actor,
        },
      });
    } catch (error) {
      const transient = isTransient(error);
      if (transient && attempts < AUTO_RETRY_MAX) {
        results.push({
          itemId: item.ItemID,
          patch: {
            Estado: 'PENDIENTE',
            UltimoError: safeCell(clean(error?.message || error), 1500),
            ActualizadoPor: actor,
          },
        });
      } else {
        results.push({
          itemId: item.ItemID,
          patch: {
            Estado: 'ERROR',
            UltimoError: safeCell(clean(error?.message || error), 1500),
            ActualizadoPor: actor,
          },
        });
        hardError = hardError || error;
      }
    }
  }
  await updateFinalizationItems(results);
  const refreshed = await listFinalizationItems(job.JobID);
  await persistProgress(ctx, id, job, refreshed, 'DRIVE');
  if (hardError) {
    await markJobError(ctx, id, job, hardError);
    return { error: true };
  }
  return { continue: true };
}

async function completeJob(ctx, id, job, items) {
  const summary = summarizeFinalizationItems(items);
  await persistProgress(ctx, id, job, items, 'CIERRE');
  const delivery = await finalizeStagedMaintenanceDelivery(ctx, id, summary.drive);
  const maintenance = await findById('Mantenimiento', id);
  const signatureIncluded = maintenanceHasSignature(maintenance);
  const actor = ctx.user?.UsuarioID || 'SISTEMA';
  const timestamp = nowIso();
  const copyErrors = summary.drive.map((item) => clean(item.UltimoError)).filter(Boolean);
  await updateRow('Mantenimiento', id, {
    Estado: 'FINALIZADO',
    FechaFinalizacion: timestamp,
    CarpetaDriveID: delivery.folderId,
    CarpetaDriveURL: delivery.folderUrl,
    EstadoNotificacion: delivery.notificationState,
    ChatDestino: delivery.destination,
    ChatEnviadoEn: delivery.notificationState === 'ENVIADO' ? timestamp : '',
    ChatFallbackPruebas: delivery.fallbackToTest,
    ImagenesEsperadas: summary.totalEvidences,
    ImagenesCopiadas: summary.copied,
    ImagenesYaExistentes: summary.existing,
    ErroresCopia: safeCell([...copyErrors, ...(delivery.errors || [])].join(' | ')),
    FirmaEstadoFinalizacion: signatureIncluded ? 'INCLUIDA' : 'OMITIDA',
    FirmaOmitidaAlFinalizar: !signatureIncluded,
    EstadoFinalizacion: 'COMPLETADO',
    PasoFinalizacion: 'COMPLETADO',
    FinalizacionProgreso: 100,
    FinalizacionMensaje: 'Mantenimiento finalizado correctamente.',
    FinalizacionActualizadaEn: timestamp,
    FinalizacionCompletadaEn: timestamp,
    UltimoErrorFinalizacion: '',
    ActualizadoPor: actor,
    FechaActualizacion: timestamp,
  });
  await updateFinalizationJob(job.JobID, {
    Estado: 'COMPLETADO',
    Fase: 'COMPLETADO',
    BoletasCompletadas: summary.completedTickets,
    DispositivosCompletados: summary.completedDevices,
    EvidenciasProcesadas: summary.processedEvidences,
    Porcentaje: 100,
    UltimoError: '',
    FechaFinalizacion: timestamp,
    ActualizadoPor: actor,
  });
  await audit(ctx, 'FINALIZAR_MANTENIMIENTO_ESCALONADO', 'Mantenimiento', id, null, {
    JobID: job.JobID,
    Boletas: summary.totalTickets,
    Dispositivos: summary.totalDevices,
    Evidencias: summary.totalEvidences,
    EvidenciasCopiadas: summary.copied,
    EvidenciasExistentes: summary.existing,
    EstadoNotificacion: delivery.notificationState,
    FirmaEstadoFinalizacion: signatureIncluded ? 'INCLUIDA' : 'OMITIDA',
  }).catch(() => {});
  return { completed: true };
}

async function stepJob(ctx, id, jobId) {
  const job = await getFinalizationJob(jobId);
  const jobState = clean(job.Estado).toUpperCase();
  if (jobState === 'COMPLETADO') return { completed: true };
  if (jobState === 'ERROR') return { error: true };

  let items = await listFinalizationItems(job.JobID);
  if (!items.length || clean(job.Fase).toUpperCase() === 'PREPARANDO') {
    return prepareJob(ctx, id, job);
  }

  let summary = summarizeFinalizationItems(items);
  if (summary.completedTickets < summary.totalTickets) {
    return processTicketStep(ctx, id, job, items);
  }
  if (clean(job.Fase).toUpperCase() === 'BOLETAS') {
    await finishTicketPhase(ctx, id, job, items);
    return { continue: true };
  }

  items = await listFinalizationItems(job.JobID);
  summary = summarizeFinalizationItems(items);
  if (summary.completedDevices < summary.totalDevices || summary.processedEvidences < summary.totalEvidences) {
    return processDriveStep(ctx, id, job, items);
  }
  return completeJob(ctx, id, job, items);
}

async function schedulerLoop() {
  while (scheduledJobs.size) {
    const entries = [...scheduledJobs.entries()];
    for (const [jobId, entry] of entries) {
      try {
        const result = await stepJob(entry.ctx, entry.maintenanceId, jobId);
        if (result.completed || result.error) scheduledJobs.delete(jobId);
        if (result.retryDelay) await sleep(result.retryDelay);
      } catch (error) {
        const job = await getFinalizationJob(jobId).catch(() => ({ JobID: jobId, Fase: 'PREPARANDO' }));
        await markJobError(entry.ctx, entry.maintenanceId, job, error).catch(() => {});
        scheduledJobs.delete(jobId);
        console.error(`[maintenance-staged-finalization][${entry.maintenanceId}]`, error);
      }
      await sleep(WORKER_DELAY_MS);
    }
  }
}

function enqueueJob(ctx, id, jobId) {
  if (!clean(jobId)) return;
  scheduledJobs.set(jobId, { ctx, maintenanceId: id });
  if (!schedulerPromise) {
    schedulerPromise = schedulerLoop().finally(() => { schedulerPromise = null; });
  }
}

function statusResponse(row = {}, job = null) {
  const state = clean(row.Estado).toUpperCase() === 'FINALIZADO'
    ? 'COMPLETADO'
    : clean(row.EstadoFinalizacion || job?.Estado || 'NINGUNO').toUpperCase();
  return {
    mantenimiento: {
      MantenimientoID: row.MantenimientoID,
      Estado: row.Estado,
      EstadoFinalizacion: state,
      PasoFinalizacion: row.PasoFinalizacion,
      FinalizacionJobID: row.FinalizacionJobID,
      FinalizacionProgreso: Number(row.FinalizacionProgreso || job?.Porcentaje || 0),
      FinalizacionTotalBoletas: Number(row.FinalizacionTotalBoletas || job?.TotalBoletas || 0),
      FinalizacionBoletasCompletadas: Number(row.FinalizacionBoletasCompletadas || job?.BoletasCompletadas || 0),
      FinalizacionTotalDispositivos: Number(row.FinalizacionTotalDispositivos || job?.TotalDispositivos || 0),
      FinalizacionDispositivosCompletados: Number(row.FinalizacionDispositivosCompletados || job?.DispositivosCompletados || 0),
      FinalizacionTotalEvidencias: Number(row.FinalizacionTotalEvidencias || job?.TotalEvidencias || 0),
      FinalizacionEvidenciasProcesadas: Number(row.FinalizacionEvidenciasProcesadas || job?.EvidenciasProcesadas || 0),
      FinalizacionMensaje: row.FinalizacionMensaje || '',
      UltimoErrorFinalizacion: row.UltimoErrorFinalizacion || job?.UltimoError || '',
      FinalizacionActualizadaEn: row.FinalizacionActualizadaEn || job?.FechaActualizacion || '',
      FinalizacionCompletadaEn: row.FinalizacionCompletadaEn || job?.FechaFinalizacion || '',
    },
    finalizationStatusOnly: true,
    staged: true,
  };
}

async function stagedFinalize(ctx) {
  const id = maintenanceId(ctx);
  if (!id) throw new AppError('VALIDATION_ERROR', 'No se indicó el mantenimiento que se debe finalizar.', 400);
  const state = await startOrResumeJob(ctx, id);
  if (state.completed) {
    return {
      ...statusResponse(state.row, state.job),
      message: 'El mantenimiento ya está finalizado.',
      completed: true,
    };
  }
  if (state.error) {
    return {
      ...statusResponse(await findById('Mantenimiento', id), state.job),
      message: 'La finalización está detenida en una unidad concreta. Use Reintentar finalización para continuar.',
      canRetry: true,
    };
  }
  enqueueJob(ctx, id, state.job.JobID);
  const current = await findById('Mantenimiento', id);
  return {
    ...statusResponse(current, state.job),
    message: 'La finalización escalonada quedó iniciada. Puede seguir utilizando la aplicación; el progreso se guarda automáticamente.',
    continue: true,
    completed: false,
  };
}

if (!maintenanceAutomationHandlers[INSTALL_FLAG]) {
  const previousFinalize = maintenanceAutomationHandlers.finalize;
  maintenanceAutomationHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return previousFinalize(ctx);
    return stagedFinalize(ctx);
  };
  maintenanceAutomationHandlers[INSTALL_FLAG] = true;
}

if (!maintenanceProgressChatHandlers[ROUTER_FLAG]) {
  const previousFinalize = maintenanceProgressChatHandlers.finalize;
  maintenanceProgressChatHandlers.finalize = async (ctx) => {
    if (testMode(ctx)) return previousFinalize(ctx);
    await ensureMaintenanceQuestionsReady(ctx.user?.UsuarioID || 'SYSTEM');
    return stagedFinalize(ctx);
  };
  maintenanceProgressChatHandlers[ROUTER_FLAG] = true;
}

if (!maintenanceProgressChatHandlers[GET_FLAG]) {
  const previousGet = maintenanceProgressChatHandlers.get;
  maintenanceProgressChatHandlers.get = async (ctx) => {
    const id = maintenanceId(ctx);
    if (ctx.payload?.finalizationStatusOnly && id) {
      await ensureProgressStorage();
      const row = await findById('Mantenimiento', id);
      const job = await findFinalizationJobForMaintenance(id, row.FinalizacionJobID).catch(() => null);
      if (job && clean(job.Estado).toUpperCase() === 'EN_PROCESO') enqueueJob(ctx, id, job.JobID);
      return statusResponse(row, job);
    }
    const result = await previousGet(ctx);
    const row = result?.mantenimiento || result || {};
    const jobId = clean(row.FinalizacionJobID);
    if (jobId && clean(row.EstadoFinalizacion).toUpperCase() === 'EN_PROCESO') enqueueJob(ctx, id, jobId);
    return result;
  };
  maintenanceProgressChatHandlers[GET_FLAG] = true;
}
