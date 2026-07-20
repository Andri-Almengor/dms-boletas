import { forbidden } from '../core/errors.js';
import { pick } from '../core/utils.js';
import { findById, readTable } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import {
  applyPublicMaintenanceSignature,
  ensureMaintenanceSignatureRequest,
  findMaintenanceSignatureRequestByToken,
  maintenanceHasSignature,
  maintenanceSignatureRequestView,
} from '../services/maintenance-signature-request.service.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false';
}

function isAdmin(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_GESTIONAR')
    || ctx.permissions?.includes('MANTENIMIENTOS_ELIMINAR');
}

async function publicMaintenanceView(maintenanceId) {
  const [maintenance, devices] = await Promise.all([
    findById('Mantenimiento', maintenanceId),
    readTable('Evidencia_Mantenimientos'),
  ]);
  const related = devices.filter((device) => (
    active(device)
    && String(device.MantenimientoRef) === String(maintenanceId)
  ));
  const categories = [...new Set(related
    .map((device) => clean(device.Categoria || device.TipoDispositivo))
    .filter(Boolean))];

  return {
    subjectType: 'maintenance',
    uid: clean(maintenance.MantenimientoID),
    number: clean(maintenance.MantenimientoID),
    title: clean(maintenance.TituloMantenimiento, 'Mantenimiento técnico'),
    clientName: clean(maintenance.Cliente, 'Cliente'),
    date: maintenance.Fecha || '',
    location: clean(maintenance.Ubicacion),
    description: clean(maintenance.DescripcionGeneral),
    supervisor: clean(maintenance.Responsables || maintenance.Responsable),
    signed: maintenanceHasSignature(maintenance),
    deviceCount: related.length,
    categories,
    visitCount: 1,
    visits: [],
  };
}

async function signatureLink(ctx, testMode = false) {
  if (testMode && !isAdmin(ctx)) {
    throw forbidden('Solo los administradores pueden probar la firma del mantenimiento.');
  }
  const maintenanceId = pick(ctx.payload, ['maintenanceId', 'MantenimientoID', 'id']);
  const request = await ensureMaintenanceSignatureRequest({
    maintenanceId,
    origin: ctx.origin,
    actor: ctx.user?.UsuarioID || 'SISTEMA',
    testMode,
  });
  const maintenance = await publicMaintenanceView(maintenanceId);
  return {
    request,
    signed: maintenance.signed,
    testMode,
    maintenance,
    ticket: maintenance,
  };
}

export const maintenanceSignatureHandlers = {
  link: async (ctx) => signatureLink(ctx, false),
  testLink: async (ctx) => signatureLink(ctx, true),

  publicGet: async (ctx) => {
    const requestRow = await findMaintenanceSignatureRequestByToken(ctx.payload.token);
    const request = maintenanceSignatureRequestView(requestRow);
    const maintenance = await publicMaintenanceView(requestRow.MantenimientoID);
    const status = request.status;
    return {
      request,
      maintenance,
      ticket: maintenance,
      alreadySigned: status === 'FIRMADA'
        || status === 'PRUEBA_COMPLETADA'
        || (!request.testMode && maintenance.signed),
      expired: status === 'EXPIRADA',
      testMode: request.testMode,
    };
  },

  publicSubmit: async (ctx) => {
    const signed = await applyPublicMaintenanceSignature({
      token: ctx.payload.token,
      base64: ctx.payload.base64,
      mimeType: ctx.payload.mimeType || 'image/png',
    });
    const maintenance = await publicMaintenanceView(signed.maintenance.MantenimientoID);
    const systemContext = {
      ...ctx,
      user: {
        UsuarioID: signed.testMode ? 'ADMIN_PRUEBA' : 'CLIENTE',
        Nombre: signed.testMode ? 'Administrador de prueba' : 'Cliente',
      },
      permissions: [],
    };

    await audit(
      systemContext,
      signed.testMode ? 'PROBAR_FIRMA_MANTENIMIENTO' : 'FIRMAR_MANTENIMIENTO_CLIENTE',
      'Mantenimiento',
      signed.maintenance.MantenimientoID,
      null,
      {
        SolicitudFirmaID: signed.request.id,
        ModoPrueba: signed.testMode,
        FirmaArchivoID: signed.file?.id || '',
        FirmaURL: signed.file?.webViewLink || '',
        BoletasSincronizadas: signed.synchronizedTickets || 0,
        EstadoMantenimientoCambiado: false,
      },
    ).catch(() => {});

    const message = signed.testMode
      ? 'Prueba completada correctamente. La firma no se guardó en el mantenimiento ni se aplicó a las boletas.'
      : signed.alreadySigned
        ? 'El mantenimiento ya contaba con la firma general del cliente.'
        : signed.synchronizedTickets > 0
          ? `La firma general fue guardada y aplicada a ${signed.synchronizedTickets} boleta(s) ya generada(s). También se usará en cualquier boleta nueva de este mantenimiento.`
          : 'La firma general fue guardada correctamente. Se aplicará automáticamente a todas las boletas que se generen desde este mantenimiento.';

    return {
      signed: true,
      alreadySigned: signed.alreadySigned,
      testMode: signed.testMode,
      request: signed.request,
      maintenance,
      ticket: maintenance,
      synchronizedTickets: signed.synchronizedTickets || 0,
      message,
    };
  },
};
