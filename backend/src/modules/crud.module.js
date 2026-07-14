import { appendRow, filterRows, readTable, updateRow } from '../infra/sheets.repository.js';
import { audit } from '../services/audit.service.js';
import { asBool, nowIso, pick, uuid } from '../core/utils.js';
import { badRequest } from '../core/errors.js';

function hasAny(object, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(object || {}, key));
}

function normalizedKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function payloadHasCanonicalField(payload, canonicalField) {
  const expected = normalizedKey(canonicalField);
  return Object.keys(payload || {}).some((key) => normalizedKey(key) === expected);
}

function mappedUpdatePatch(definitionKey, def, payload) {
  const mapped = def.map(payload);
  const patch = Object.fromEntries(Object.entries(mapped).filter(([field]) => payloadHasCanonicalField(payload, field)));

  // RazonSocial se mantiene sincronizada con el nombre visible del cliente.
  if (definitionKey === 'clients' && hasAny(payload, ['Nombre', 'Clientes', 'Cliente', 'name'])) {
    patch.Nombre = mapped.Nombre;
    patch.RazonSocial = mapped.RazonSocial;
  }

  // El webhook se puede borrar de forma intencional enviando una cadena vacía.
  if (definitionKey === 'clients' && hasAny(payload, ['ChatWebhook', 'ChatWebhookURL', 'chatWebhook'])) {
    patch.ChatWebhook = mapped.ChatWebhook || '';
  }

  return patch;
}

function canViewClientWebhook(ctx) {
  return ctx.permissions?.includes('USUARIOS_GESTIONAR') || ctx.permissions?.includes('CLIENTES_EDITAR');
}

function canIncludeInactive(ctx, definitionKey) {
  if (ctx.permissions?.includes('USUARIOS_GESTIONAR')) return true;
  if (definitionKey === 'clients' || ['clientLocations', 'equipmentLocations', 'contacts'].includes(definitionKey)) {
    return ctx.permissions?.includes('CLIENTES_EDITAR');
  }
  if (definitionKey === 'knowledgeCategories') {
    return ctx.permissions?.includes('CONOCIMIENTO_CATEGORIAS_GESTIONAR');
  }
  return ctx.permissions?.includes('CATALOGOS_GESTIONAR');
}

function sanitizeClientRow(row, ctx) {
  if (canViewClientWebhook(ctx)) return row;
  const configured = Boolean(row.ChatWebhook || row.ChatWebhookURL);
  const { ChatWebhook: _chatWebhook, ChatWebhookURL: _chatWebhookUrl, ...safe } = row;
  return { ...safe, ChatConfigurado: configured };
}

export const CRUD_DEFINITIONS = Object.freeze({
  clients: {
    table: 'Clientes',
    id: 'ClienteID',
    search: ['Nombre','RazonSocial','CorreoGeneral','Telefono'],
    map: (p) => ({
      Nombre: pick(p,['Nombre','Clientes','Cliente','name']),
      RazonSocial: pick(p,['RazonSocial','Nombre','Clientes','name']),
      Contacto: pick(p,['Contacto','contacto']),
      Telefono: pick(p,['Telefono','Telefonos','telefono']),
      CorreoGeneral: pick(p,['CorreoGeneral','Correo','correo']),
      Direccion: pick(p,['Direccion','DireccionEnvio','direccion']),
      SitioWeb: pick(p,['SitioWeb','sitioWeb']),
      Estado: pick(p,['Estado','status'],'ACTIVO'),
      ...(hasAny(p, ['ChatWebhook','ChatWebhookURL','chatWebhook'])
        ? { ChatWebhook: pick(p,['ChatWebhook','ChatWebhookURL','chatWebhook']) }
        : {}),
    }),
  },
  clientLocations: { table: 'ClienteUbicaciones', id: 'UbicacionID', search: ['Nombre','Direccion','Notas'], parent: 'ClienteID', map: (p) => ({ ClienteID: pick(p,['ClienteID','clienteId']), Nombre: pick(p,['Nombre','nombre']), Direccion: pick(p,['Direccion','direccion']), Notas: pick(p,['Notas','notas']) }) },
  equipmentLocations: { table: 'ClienteUbicacionesEquipo', id: 'UbicacionEquipoID', search: ['Nombre','Descripcion'], parent: 'UbicacionID', map: (p) => ({ UbicacionID: pick(p,['UbicacionID','ubicacionId']), Nombre: pick(p,['Nombre','nombre']), Descripcion: pick(p,['Descripcion','descripcion']) }) },
  contacts: { table: 'ClienteContactos', id: 'ContactoID', search: ['Nombre','Correo','Puesto','Telefono'], parent: 'ClienteID', map: (p) => ({ ClienteID: pick(p,['ClienteID','clienteId']), Nombre: pick(p,['Nombre','nombre']), Correo: pick(p,['Correo','correo']), Puesto: pick(p,['Puesto','puesto']), Telefono: pick(p,['Telefono','telefono']), EsSupervisor: asBool(p.EsSupervisor ?? p.esSupervisor, false), RecibeCorreo: asBool(p.RecibeCorreo ?? p.recibeCorreo, true) }) },
  categories: { table: 'Categorias', id: 'CategoriaID', search: ['Nombre','Descripcion'], map: (p) => ({ Nombre: pick(p,['Nombre','nombre']), Descripcion: pick(p,['Descripcion','descripcion']) }) },
  deviceTypes: { table: 'TiposDispositivo', id: 'TipoDispositivoID', search: ['Nombre','Descripcion'], map: (p) => ({ Nombre: pick(p,['Nombre','nombre']), Descripcion: pick(p,['Descripcion','descripcion']) }) },
  manufacturers: { table: 'Fabricantes', id: 'FabricanteID', search: ['Nombre'], map: (p) => ({ Nombre: pick(p,['Nombre','nombre']), LogoURL: pick(p,['LogoURL','logoUrl']) }) },
  models: { table: 'Modelos', id: 'ModeloID', search: ['Nombre','Descripcion'], map: (p) => ({ TipoDispositivoID: pick(p,['TipoDispositivoID','tipoDispositivoId']), FabricanteID: pick(p,['FabricanteID','fabricanteId']), Nombre: pick(p,['Nombre','nombre']), ImagenReferenciaURL: pick(p,['ImagenReferenciaURL','imagenReferenciaURL']), Descripcion: pick(p,['Descripcion','descripcion']) }) },
  failureTypes: { table: 'TiposFalla', id: 'TipoFallaID', search: ['Nombre','Descripcion'], map: (p) => ({ Nombre: pick(p,['Nombre','nombre']), Descripcion: pick(p,['Descripcion','descripcion']) }) },
  deviceManufacturers: { table: 'TipoDispositivoFabricantes', id: 'RelacionID', search: [], map: (p) => ({ TipoDispositivoID: pick(p,['TipoDispositivoID','tipoDispositivoId']), FabricanteID: pick(p,['FabricanteID','fabricanteId']) }) },
  knowledgeCategories: { table: 'KnowledgeCategories', id: 'CategoriaConocimientoID', search: ['Nombre','Descripcion'], map: (p) => ({ Nombre: pick(p,['Nombre','nombre']), Descripcion: pick(p,['Descripcion','descripcion']), Icono: pick(p,['Icono','icono']) }) },
});

export function crudHandlers(definitionKey) {
  const def = CRUD_DEFINITIONS[definitionKey];
  return {
    list: async (ctx) => {
      const { payload } = ctx;
      let rows = await readTable(def.table);
      const includeInactive = asBool(payload.includeInactive, false) && canIncludeInactive(ctx, definitionKey);
      if (!includeInactive) {
        rows = rows.filter((row) => String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO' && row.Activo !== false);
      }
      if (def.parent) {
        const parentValue = payload[def.parent] ?? payload[def.parent.charAt(0).toLowerCase() + def.parent.slice(1)] ?? payload.clienteId ?? payload.ubicacionId;
        if (parentValue) rows = rows.filter((row) => String(row[def.parent]) === String(parentValue));
      }
      const result = filterRows(rows, payload, def.search);
      if (definitionKey === 'clients') result.items = result.items.map((row) => sanitizeClientRow(row, ctx));
      return result;
    },
    get: async (ctx) => {
      const { payload } = ctx;
      const rows = await readTable(def.table); const id = pick(payload, [def.id, 'id', 'clienteId', 'ubicacionId', 'contactoId']);
      const row = rows.find((item) => String(item[def.id]) === String(id)); if (!row) throw badRequest('No se encontró el registro.');
      return definitionKey === 'clients' ? sanitizeClientRow(row, ctx) : row;
    },
    create: async (ctx) => {
      const mapped = def.map(ctx.payload);
      if (!mapped.Nombre && ['clients','categories','deviceTypes','manufacturers','models','failureTypes','knowledgeCategories'].includes(definitionKey)) throw badRequest('El nombre es obligatorio.');
      const row = { [def.id]: uuid(), ...mapped, Activo: true, Estado: mapped.Estado || 'ACTIVO', CreadoPor: ctx.user.UsuarioID, FechaCreacion: nowIso(), ActualizadoPor: ctx.user.UsuarioID, FechaActualizacion: nowIso() };
      await appendRow(def.table, row); await audit(ctx, `CREAR_${def.table.toUpperCase()}`, def.table, row[def.id], null, row); return row;
    },
    update: async (ctx) => {
      const id = pick(ctx.payload, [def.id,'id','clienteId','ubicacionId','contactoId']); if (!id) throw badRequest('Falta el identificador.');
      const before = (await readTable(def.table)).find((row) => String(row[def.id]) === String(id));
      if (!before) throw badRequest('No se encontró el registro.');
      const mapped = mappedUpdatePatch(definitionKey, def, ctx.payload);
      const patch = {
        ...mapped,
        Activo: ctx.payload.Activo ?? ctx.payload.activo ?? before.Activo ?? true,
        Estado: pick(ctx.payload,['Estado','status'],before.Estado || 'ACTIVO'),
        ActualizadoPor: ctx.user.UsuarioID,
        FechaActualizacion: nowIso(),
      };
      const after = await updateRow(def.table, id, patch); await audit(ctx, `EDITAR_${def.table.toUpperCase()}`, def.table, id, before, after); return after;
    },
  };
}
