import { badRequest } from '../core/errors.js';
import { asBool, pick } from '../core/utils.js';
import { readTables } from '../infra/sheets.repository.js';
import { buildClientRelations } from '../services/client-relations.service.js';

function canIncludeInactive(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR') || ctx.permissions?.includes('CLIENTES_EDITAR');
}

export const clientRelationsHandlers = {
  get: async (ctx) => {
    const clientId = String(pick(ctx.payload, ['ClienteID', 'clienteId', 'id']) || '').trim();
    if (!clientId) throw badRequest('Falta el identificador del cliente.');

    const includeInactive = asBool(ctx.payload.includeInactive, false) && canIncludeInactive(ctx);
    const tables = await readTables([
      'ClienteUbicaciones',
      'ClienteUbicacionesEquipo',
      'ClienteContactos',
    ]);

    return buildClientRelations({
      clientId,
      locations: tables.ClienteUbicaciones,
      equipment: tables.ClienteUbicacionesEquipo,
      contacts: tables.ClienteContactos,
      includeInactive,
    });
  },
};
