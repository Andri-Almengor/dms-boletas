import { appendRow } from '../infra/sheets.repository.js';
import { uuid, nowIso } from '../core/utils.js';

export async function audit(ctx, action, entity, entityId, before = null, after = null) {
  try {
    await appendRow('Auditoria', { AuditoriaID: uuid(), UsuarioID: ctx?.user?.UsuarioID || 'SYSTEM', UsuarioNombre: ctx?.user?.NombreCompleto || 'SYSTEM', Accion: action, Entidad: entity, EntidadID: entityId || '', DatosAntesJSON: before ? JSON.stringify(before) : '', DatosDespuesJSON: after ? JSON.stringify(after) : '', IP: ctx?.ip || '', UserAgent: ctx?.userAgent || '', Fecha: nowIso() });
  } catch (error) { console.error('No se pudo registrar auditoría:', error.message); }
}
