function isActiveRecord(row = {}) {
  const status = String(row.Estado || 'ACTIVO').trim().toUpperCase();
  const activeValue = String(row.Activo ?? true).trim().toLowerCase();
  return status !== 'INACTIVO' && !['false', '0', 'no', 'inactivo'].includes(activeValue);
}

function compareByName(left = {}, right = {}) {
  const leftName = String(left.Nombre || left.name || '').trim();
  const rightName = String(right.Nombre || right.name || '').trim();
  return leftName.localeCompare(rightName, 'es', { sensitivity: 'base', numeric: true });
}

function filterActive(rows, includeInactive) {
  return includeInactive ? rows : rows.filter(isActiveRecord);
}

export function buildClientRelations({
  clientId,
  locations = [],
  equipment = [],
  contacts = [],
  includeInactive = false,
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  const clientLocations = filterActive(locations, includeInactive)
    .filter((row) => String(row.ClienteID || row.clienteId || '') === normalizedClientId)
    .sort(compareByName);
  const locationIds = new Set(clientLocations
    .map((row) => String(row.UbicacionID || row.ubicacionId || row.id || ''))
    .filter(Boolean));
  const clientEquipment = filterActive(equipment, includeInactive)
    .filter((row) => locationIds.has(String(row.UbicacionID || row.ubicacionId || '')))
    .sort(compareByName);
  const clientContacts = filterActive(contacts, includeInactive)
    .filter((row) => String(row.ClienteID || row.clienteId || '') === normalizedClientId)
    .sort(compareByName);

  return {
    locations: clientLocations,
    equipment: clientEquipment,
    contacts: clientContacts,
    counts: {
      locations: clientLocations.length,
      equipment: clientEquipment.length,
      contacts: clientContacts.length,
    },
  };
}
