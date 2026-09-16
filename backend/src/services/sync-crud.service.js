import { materializeCrudDeltaFromRows } from '../core/sync-crud-delta.js';
import { CRUD_DEFINITIONS } from '../modules/crud.module.js';
import { readTable } from '../infra/sheets.repository.js';

const RESOURCE_DEFINITIONS = Object.freeze({
  client: 'clients',
  clientLocation: 'clientLocations',
  equipmentLocation: 'equipmentLocations',
  contact: 'contacts',
  catalogCategory: 'categories',
  deviceType: 'deviceTypes',
  manufacturer: 'manufacturers',
  model: 'models',
  failureType: 'failureTypes',
  deviceManufacturerRelation: 'deviceManufacturers',
  knowledgeCategory: 'knowledgeCategories',
});

export function isCrudSyncResource(resource) {
  return Object.prototype.hasOwnProperty.call(RESOURCE_DEFINITIONS, String(resource || ''));
}

function canViewClientWebhook(ctx = {}) {
  const permissions = ctx.permissions || [];
  return permissions.includes('USUARIOS_GESTIONAR') || permissions.includes('CLIENTES_EDITAR');
}

function sanitizeClientRow(row, ctx) {
  if (canViewClientWebhook(ctx)) return row;
  const configured = Boolean(row?.ChatWebhook || row?.ChatWebhookURL);
  const { ChatWebhook: _chatWebhook, ChatWebhookURL: _chatWebhookUrl, ...safe } = row || {};
  return { ...safe, ChatConfigurado: configured };
}

export async function materializeCrudDelta(ctx = {}, resource = '', events = []) {
  const definitionKey = RESOURCE_DEFINITIONS[String(resource || '')];
  const definition = CRUD_DEFINITIONS[definitionKey];
  if (!definition) return null;

  const rows = await readTable(definition.table);
  return materializeCrudDeltaFromRows({
    events,
    rows,
    idField: definition.id,
    transformRow: resource === 'client'
      ? (row) => sanitizeClientRow(row, ctx)
      : (row) => row,
  });
}
