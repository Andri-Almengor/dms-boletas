import { badRequest } from '../core/errors.js';
import { nowIso, pick, uuid } from '../core/utils.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';
import {
  appendRow,
  findById,
  readTable,
  updateRow,
} from '../infra/sheets.repository.js';
import { generateInitialCaseEmail } from './customer-case-gemini.service.js';
import { sendNewCustomerCaseEmail } from './customer-case-email.service.js';
import { audit } from './audit.service.js';

const INSTALL_FLAG = Symbol.for('dms.customerCaseInitialEmailRetry');

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'prueba'].includes(clean(value, 20).toLowerCase());
}

function initialRequest(payload = {}) {
  return ['INITIAL', 'INICIAL', 'CREATED', 'CREADO'].includes(
    clean(pick(payload, ['notificationType', 'tipoNotificacion', 'emailType']), 30).toUpperCase(),
  );
}

function evidenceRows(rows, caseId) {
  return rows.filter((row) => (
    clean(row.CasoID, 220) === clean(caseId, 220)
    && row.Activo !== false
  ));
}

async function notificationRecord({ ctx, caseData, result = null, error = null }) {
  const recipients = [
    ...(Array.isArray(result?.to) ? result.to : []),
    ...(Array.isArray(result?.cc) ? result.cc : []),
  ];
  await appendRow('Notificaciones', {
    NotificacionID: uuid(),
    Entidad: 'CASO_CLIENTE',
    EntidadID: caseData.CasoID,
    Canal: 'CORREO',
    Destino: recipients.join(', ') || 'Destinatarios configurados',
    Tipo: booleanValue(caseData.ModoPrueba || caseData.EsPrueba)
      ? 'REENVIO_CASO_CREADO_PRUEBA'
      : 'REENVIO_CASO_CREADO',
    Estado: error ? 'ERROR' : 'ENVIADO',
    Intentos: 1,
    Respuesta: result ? JSON.stringify(result).slice(0, 1500) : '',
    Error: error ? clean(error.message || error, 1500) : '',
    FechaCreacion: nowIso(),
    FechaEnvio: error ? '' : nowIso(),
    CreadoPor: ctx.user.UsuarioID,
  }).catch(() => {});
}

async function resendInitialEmail(ctx) {
  const caseId = clean(pick(ctx.payload, ['caseId', 'CasoID', 'id']), 220);
  if (!caseId) throw badRequest('No se indicó el caso que se desea notificar.');

  const caseData = await findById('CasosClientes', caseId);
  const evidences = evidenceRows(await readTable('CasoEvidencias'), caseId);
  const generated = await generateInitialCaseEmail(caseData);

  try {
    const result = await sendNewCustomerCaseEmail({
      caseData,
      evidences,
      message: generated,
      forceResend: true,
    });
    const updated = await updateRow('CasosClientes', caseId, {
      AsuntoCorreoInicial: generated.subject,
      CuerpoCorreoInicial: generated.body,
      GeminiModeloInicial: generated.model || '',
      GeminiUsadoInicial: generated.generatedByGemini,
      EstadoNotificacionInicial: 'ENVIADO',
      UltimoErrorNotificacion: generated.warning || '',
      FechaActualizacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
    });
    await notificationRecord({ ctx, caseData: updated, result });
    await audit(
      ctx,
      'REENVIAR_CORREO_INICIAL_CASO',
      'CasosClientes',
      caseId,
      caseData,
      {
        EstadoNotificacionInicial: 'ENVIADO',
        Destinatarios: [...(result.to || []), ...(result.cc || [])],
        EvidenciasAdjuntas: evidences.length,
      },
    ).catch(() => {});
    return {
      sent: true,
      case: updated,
      recipients: {
        to: result.to || [],
        cc: result.cc || [],
      },
      evidenceCount: evidences.length,
      attachmentCount: Number(result.attachmentCount || 0),
      message: 'El correo inicial fue reenviado a los destinatarios configurados.',
    };
  } catch (error) {
    const updated = await updateRow('CasosClientes', caseId, {
      EstadoNotificacionInicial: 'ERROR',
      UltimoErrorNotificacion: clean(error.message || error, 1500),
      FechaActualizacion: nowIso(),
      ActualizadoPor: ctx.user.UsuarioID,
    }).catch(() => caseData);
    await notificationRecord({ ctx, caseData: updated, error });
    throw error;
  }
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  const originalPublicSubmit = customerCaseHandlers.publicSubmit;
  const originalResendTechnicians = customerCaseHandlers.resendTechnicians;

  customerCaseHandlers.publicSubmit = async (ctx) => {
    const result = await originalPublicSubmit(ctx);
    const failed = Number(result?.failedEvidenceCount || 0);
    if (failed > 0) {
      result.evidenceUploadWarning = failed === 1
        ? 'El caso fue creado, pero 1 evidencia no se pudo cargar.'
        : `El caso fue creado, pero ${failed} evidencias no se pudieron cargar.`;
    }
    if (result?.testMode) {
      result.message = result.notificationSent
        ? `El caso de prueba ${result.caseNumber} fue creado y se notificó a los destinatarios configurados para pruebas.`
        : `El caso de prueba ${result.caseNumber} fue creado, pero el correo inicial quedó pendiente de reenvío.`;
    }
    return result;
  };

  customerCaseHandlers.resendTechnicians = async (ctx) => (
    initialRequest(ctx.payload)
      ? resendInitialEmail(ctx)
      : originalResendTechnicians(ctx)
  );

  customerCaseHandlers[INSTALL_FLAG] = true;
}

export const CUSTOMER_CASE_INITIAL_EMAIL_RETRY = Object.freeze({
  notificationType: 'INITIAL',
});
