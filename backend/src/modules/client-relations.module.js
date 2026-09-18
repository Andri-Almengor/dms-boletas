import { badRequest } from '../core/errors.js';
import { asBool, pick } from '../core/utils.js';
import { findRows } from '../infra/sheets.repository.js';
import { buildClientRelations } from '../services/client-relations.service.js';

function canIncludeInactive(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR') || ctx.permissions?.includes('CLIENTES_EDITAR');
}

export const clientRelationsHandlers = {
  get: async (ctx) => {
    const clientId = String(pick(ctx.payload, ['ClienteID', 'clienteId', 'id']) || '').trim();
    if (!clientId) throw badRequest('Falta el identificador del cliente.');

    const includeInactive = asBool(ctx.payload.includeInactive, false) && canIncludeInactive(ctx);
    const [locations, contacts] = await Promise.all([
      findRows('ClienteUbicaciones', { ClienteID: clientId }, { limit: 50_000 }),
      findRows('ClienteContactos', { ClienteID: clientId }, { limit: 50_000 }),
    ]);
    const locationIds = locations.map((row) => String(row.UbicacionID || '')).filter(Boolean);
    const equipment = locationIds.length
      ? await findRows('ClienteUbicacionesEquipo', { UbicacionID: locationIds }, { limit: 50_000 })
      : [];

    return buildClientRelations({
      clientId,
      locations,
      equipment,
      contacts,
      includeInactive,
    });
  },
};
