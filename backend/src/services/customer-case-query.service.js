function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeCustomerCaseState(value) {
  const state = clean(value, 40).toUpperCase().replace(/[\s-]+/g, '_');
  if (['EN_ESPERA', 'ESPERA', 'PENDIENTE'].includes(state)) return 'EN_ESPERA';
  if (['EN_PROCESO', 'PROCESO'].includes(state)) return 'EN_PROCESO';
  if (['FINALIZADO', 'FINALIZADA', 'FINAL'].includes(state)) return 'FINALIZADO';
  return 'EN_ESPERA';
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(clean(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return clean(value).split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
}

export function customerCaseView(item = {}) {
  return {
    ...item,
    CasoID: clean(item.CasoID),
    CasoNumero: clean(item.CasoNumero),
    Estado: normalizeCustomerCaseState(item.Estado),
    TecnicoIDs: parseArray(item.TecnicoIDsJSON),
    EvidenciaCount: Number(item.EvidenciaCount || 0),
    Activo: item.Activo !== false,
  };
}

export function buildCustomerCaseList(rows = [], {
  state = '',
  clientId = '',
  search = '',
  page = 1,
  pageSize = 60,
} = {}) {
  const requestedState = clean(state, 50);
  const requestedClient = clean(clientId, 200);
  const requestedSearch = clean(search, 300).toLowerCase();
  const normalizedRequestedState = requestedState ? normalizeCustomerCaseState(requestedState) : '';
  const candidates = [];
  const counts = {
    EN_ESPERA: 0,
    EN_PROCESO: 0,
    FINALIZADO: 0,
    TOTAL: 0,
  };

  for (const raw of rows) {
    if (raw?.Activo === false) continue;
    const item = customerCaseView(raw);
    counts.TOTAL += 1;
    counts[item.Estado] += 1;

    if (normalizedRequestedState && item.Estado !== normalizedRequestedState) continue;
    if (requestedClient && clean(item.ClienteID) !== requestedClient) continue;
    if (requestedSearch) {
      const searchable = `${item.CasoNumero} ${item.Cliente} ${item.RazonVisita} ${item.Problema} ${item.NombreSolicitante} ${item.CorreoSolicitante}`.toLowerCase();
      if (!searchable.includes(requestedSearch)) continue;
    }
    candidates.push(item);
  }

  candidates.sort((left, right) => clean(right.FechaCreacion).localeCompare(clean(left.FechaCreacion)));
  const total = candidates.length;
  return {
    items: candidates.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    counts,
  };
}
