import { forbidden } from '../core/errors.js';

function has(ctx, code) {
  return Array.isArray(ctx?.permissions) && ctx.permissions.includes(code);
}

export function canViewAllTickets(ctx) {
  return has(ctx, 'USUARIOS_GESTIONAR')
    || has(ctx, 'BOLETAS_GESTIONAR')
    || has(ctx, 'BOLETAS_ELIMINAR');
}

export function aiAccess(ctx = {}) {
  const admin = has(ctx, 'USUARIOS_GESTIONAR');
  const tickets = admin || canViewAllTickets(ctx) || has(ctx, 'BOLETAS_VER');
  const maintenance = admin || [
    'MANTENIMIENTOS_VER',
    'MANTENIMIENTOS_CREAR',
    'MANTENIMIENTOS_EDITAR',
    'MANTENIMIENTOS_GESTIONAR',
    'BOLETAS_VER',
  ].some((code) => has(ctx, code));
  return {
    admin,
    tickets,
    maintenance,
    clients: Boolean(ctx?.user?.UsuarioID),
    users: admin || has(ctx, 'USUARIOS_VER') || tickets,
    attachments: Boolean(ctx?.user?.UsuarioID),
    knowledge: Boolean(ctx?.user?.UsuarioID),
    cases: admin,
    statistics: tickets || maintenance,
  };
}

export function assertAiCapability(ctx, capability) {
  const access = aiAccess(ctx);
  if (!access[capability]) {
    throw forbidden('No cuenta con permiso para consultar esa información desde el asistente.');
  }
  return access;
}

export function appendTicketVisibility(ctx, params, alias = 'b') {
  if (canViewAllTickets(ctx)) return 'TRUE';
  const userId = String(ctx?.user?.UsuarioID || '').trim();
  if (!userId) return 'FALSE';
  params.push(userId);
  const p = '$' + params.length;
  return `EXISTS (
    SELECT 1
      FROM "BoletaAsignados" ai_ba
     WHERE ai_ba."__valid"=TRUE
       AND LOWER(COALESCE(ai_ba."Activo",'true')) <> 'false'
       AND ai_ba."BoletaUID"=${alias}."BoletaUID"
       AND ai_ba."UsuarioID"=${p}
  )`;
}

export function appendKnowledgeVisibility(ctx, params, alias = 'a') {
  if (has(ctx, 'USUARIOS_GESTIONAR') || has(ctx, 'CONOCIMIENTO_GESTIONAR')) return 'TRUE';
  params.push(String(ctx?.user?.UsuarioID || '').trim());
  const p = '$' + params.length;
  return `(
    UPPER(COALESCE(${alias}."Estado",'PUBLICADO'))='PUBLICADO'
    OR ${alias}."AutorUsuarioID"=${p}
  )`;
}
