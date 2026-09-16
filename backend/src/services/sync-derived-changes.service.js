import { readTable } from '../infra/sheets.repository.js';
import { isActiveKnowledgeRelation } from './knowledge-enrichment-index.js';
import { SYNC_MUTATION_CLASS } from './sync-resource-registry.js';

const EQUIPMENT_LOCATION_UPDATE_ROUTES = new Set([
  'equipmentLocations.update',
  'clients.equipmentLocations.update',
  'clientes.ubicacionesEquipo.update',
  'ubicacionesEquipo.update',
]);

const CUSTOMER_CASE_PROCESS_ROUTES = new Set([
  'customerCases.process',
  'casos.cliente.procesar',
]);

function clean(value) {
  return String(value ?? '').trim();
}

function syncClassification(resource, entityId, route, derivedFrom, operation = 'UPSERT') {
  return {
    classification: SYNC_MUTATION_CLASS.SYNC_RESOURCE,
    resource,
    entityId: clean(entityId),
    operation,
    metadata: {
      action: clean(route).slice(0, 120),
      derivedFrom: clean(derivedFrom).slice(0, 80),
    },
  };
}

async function equipmentLocationDerivedChanges(route, payload, result) {
  if (!EQUIPMENT_LOCATION_UPDATE_ROUTES.has(route)) return [];
  if (payload?.Nombre === undefined && payload?.nombre === undefined) return [];
  const locationId = clean(result?.UbicacionEquipoID || result?.id);
  if (!locationId) return [];

  const devices = await readTable('Evidencia_Mantenimientos');
  const maintenanceIds = [...new Set(
    devices
      .filter((row) => clean(row.UbicacionEquipoID) === locationId)
      .map((row) => clean(row.MantenimientoRef))
      .filter(Boolean),
  )];
  return maintenanceIds.map((maintenanceId) => (
    syncClassification('maintenance', maintenanceId, route, 'equipmentLocation')
  ));
}

async function modelRelationDerivedChanges(route, result, primaryClassification) {
  if (primaryClassification?.resource !== 'model' || primaryClassification?.operation !== 'UPSERT') return [];
  const typeId = clean(result?.TipoDispositivoID);
  const manufacturerId = clean(result?.FabricanteID);
  if (!typeId || !manufacturerId) return [];

  const relations = await readTable('TipoDispositivoFabricantes');
  const relation = relations.find((row) => (
    clean(row.TipoDispositivoID) === typeId
    && clean(row.FabricanteID) === manufacturerId
    && row.Activo !== false
    && String(row.Estado || 'ACTIVO').toUpperCase() !== 'INACTIVO'
  ));
  const relationId = clean(relation?.RelacionID);
  return relationId
    ? [syncClassification('deviceManufacturerRelation', relationId, route, 'modelRelationship')]
    : [];
}

async function knowledgeCategoryArticleChanges(route, result, primaryClassification) {
  if (primaryClassification?.resource !== 'knowledgeCategory' || primaryClassification?.operation !== 'UPSERT') return [];
  if (!/\.update$/i.test(clean(route))) return [];
  const categoryId = clean(result?.CategoriaConocimientoID || result?.CategoriaID || result?.id);
  if (!categoryId) return [];

  const relations = await readTable('KnowledgeArticleCategories');
  const tutorialIds = [...new Set(
    relations
      .filter((row) => (
        clean(row.CategoriaConocimientoID) === categoryId
        && isActiveKnowledgeRelation(row)
      ))
      .map((row) => clean(row.TutorialID))
      .filter(Boolean),
  )];
  return tutorialIds.map((tutorialId) => (
    syncClassification('knowledgeArticle', tutorialId, route, 'knowledgeCategory')
  ));
}

function ticketCanChangeAgendaView(route, primaryClassification) {
  if (primaryClassification?.resource !== 'ticket') return false;
  const normalized = clean(route).toLowerCase();
  if (normalized.includes('.evidence.') || normalized.includes('.evidencia.')) return false;
  if (normalized.includes('.media.')) return false;
  return true;
}

function ticketAgendaDerivedChanges(route, primaryClassification) {
  if (!ticketCanChangeAgendaView(route, primaryClassification)) return [];
  return [syncClassification('agenda', '*', route, 'ticketMatching', 'INVALIDATE')];
}

function customerCaseProcessDerivedChanges(route, result) {
  if (!CUSTOMER_CASE_PROCESS_ROUTES.has(route)) return [];
  const ticketId = clean(result?.case?.BoletaUID || result?.ticket?.BoletaUID || result?.BoletaUID);
  if (!ticketId) return [];
  return [
    syncClassification('ticket', ticketId, route, 'customerCaseProcess'),
    syncClassification('agenda', '*', route, 'customerCaseTicketMatching', 'INVALIDATE'),
  ];
}

function ticketFinalizationCaseDerivedChanges(route, result, primaryClassification) {
  if (primaryClassification?.resource !== 'ticket') return [];
  const caseId = clean(result?.customerCase?.CasoID || result?.customerCase?.caseId);
  if (!caseId) return [];
  return [syncClassification('customerCase', caseId, route, 'ticketFinalization')];
}

export async function collectDerivedSyncClassifications({
  route = '',
  payload = {},
  result = null,
  primaryClassification = null,
} = {}) {
  const normalizedRoute = clean(route);
  const [equipmentChanges, relationChanges, knowledgeChanges] = await Promise.all([
    equipmentLocationDerivedChanges(normalizedRoute, payload, result || {}),
    modelRelationDerivedChanges(normalizedRoute, result || {}, primaryClassification),
    knowledgeCategoryArticleChanges(normalizedRoute, result || {}, primaryClassification),
  ]);
  const agendaChanges = ticketAgendaDerivedChanges(normalizedRoute, primaryClassification);
  const caseProcessChanges = customerCaseProcessDerivedChanges(normalizedRoute, result || {});
  const ticketCaseChanges = ticketFinalizationCaseDerivedChanges(normalizedRoute, result || {}, primaryClassification);

  const seen = new Set();
  return [
    ...equipmentChanges,
    ...relationChanges,
    ...knowledgeChanges,
    ...agendaChanges,
    ...caseProcessChanges,
    ...ticketCaseChanges,
  ].filter((classification) => {
    const key = `${classification.resource}:${classification.entityId}:${classification.operation}`;
    if (!classification.entityId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
