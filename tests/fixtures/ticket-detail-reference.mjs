// Frozen enrichment at 8bcaacc; loaded with stubbed repository in regression tests.
function clean(value) {
  return String(value ?? '').trim();
}

function comparable(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const CATALOG_SPECS = [
  { table: 'TiposFalla', idKeys: ['TipoFallaID', 'tipoFallaId'], labelKeys: ['TipoFalla', 'tipoFalla'], rowId: 'TipoFallaID', rowLabel: 'Nombre', targetId: 'TipoFallaID', targetLabel: 'TipoFalla' },
  { table: 'TiposDispositivo', idKeys: ['TipoDispositivoID', 'tipoDispositivoId'], labelKeys: ['TipoDispositivo', 'tipoDispositivo'], rowId: 'TipoDispositivoID', rowLabel: 'Nombre', targetId: 'TipoDispositivoID', targetLabel: 'TipoDispositivo' },
  { table: 'Fabricantes', idKeys: ['FabricanteID', 'fabricanteId'], labelKeys: ['Fabricante', 'fabricante'], rowId: 'FabricanteID', rowLabel: 'Nombre', targetId: 'FabricanteID', targetLabel: 'Fabricante' },
  { table: 'Modelos', idKeys: ['ModeloID', 'modeloId'], labelKeys: ['Modelo', 'modelo'], rowId: 'ModeloID', rowLabel: 'Nombre', targetId: 'ModeloID', targetLabel: 'Modelo' },
];

function matchCatalogRow(rows, source, spec) {
  const currentId = clean(pick(source, spec.idKeys));
  const currentLabel = comparable(pick(source, spec.labelKeys));
  return rows.find((row) => currentId && clean(row[spec.rowId]) === currentId)
    || rows.find((row) => currentLabel && comparable(row[spec.rowLabel]) === currentLabel)
    || null;
}

async function normalizeCatalogPayload(payload = {}) {
  const tables = await readTables(CATALOG_SPECS.map((spec) => spec.table));
  const next = { ...payload };
  for (const spec of CATALOG_SPECS) {
    const match = matchCatalogRow(tables[spec.table] || [], next, spec);
    if (!match) continue;
    const id = clean(match[spec.rowId]);
    const label = clean(match[spec.rowLabel]);
    next[spec.targetId] = id;
    next[spec.targetLabel] = label;
    const camelId = spec.idKeys.find((key) => key[0] === key[0].toLowerCase());
    const camelLabel = spec.labelKeys.find((key) => key[0] === key[0].toLowerCase());
    if (camelId) next[camelId] = id;
    if (camelLabel) next[camelLabel] = label;
  }
  return next;
}

async function repairStoredCatalogReferences(ticket, actor = 'SISTEMA') {
  if (!ticket?.BoletaUID) return ticket;
  const normalized = await normalizeCatalogPayload(ticket);
  const patch = {};
  for (const spec of CATALOG_SPECS) {
    const id = clean(normalized[spec.targetId]);
    const label = clean(normalized[spec.targetLabel]);
    if (id && id !== clean(ticket[spec.targetId])) patch[spec.targetId] = id;
    if (label && label !== clean(ticket[spec.targetLabel])) patch[spec.targetLabel] = label;
  }
  if (!Object.keys(patch).length) return ticket;
  return updateRow('Boletas', ticket.BoletaUID, {
    ...patch,
    ActualizadoPor: actor,
    FechaActualizacion: nowIso(),
  });
}

function assignedView(ticketId, assignmentsByTicket, usersById) {
  return (assignmentsByTicket.get(clean(ticketId)) || []).map((item) => {
    const user = usersById.get(clean(item.UsuarioID));
    const name = clean(user?.NombreCompleto || user?.Nombre || user?.NombreUsuario || item.NombreUsuarioSnapshot || item.UsuarioID);
    return {
      ...item,
      NombreCompleto: name,
      Nombre: name,
      NombreUsuario: clean(user?.NombreUsuario),
      Correo: clean(user?.Correo),
    };
  });
}

async function enrichWithVisitGroup(bundle, actor = 'SISTEMA') {
  const sourceTicket = bundle?.boleta || bundle;
  if (!sourceTicket?.BoletaUID) return bundle;
  const ticket = await repairStoredCatalogReferences(sourceTicket, actor);
  const [group, tables] = await Promise.all([
    ensureVisitGroupForTicket(ticket.BoletaUID, actor),
    readTables(['BoletaAsignados', 'EvidenciasBoleta', 'Usuarios']),
  ]);
  const usersById = indexRowsBy(tables.Usuarios, (user) => user.UsuarioID);
  const assignmentsByTicket = groupRowsBy(
    tables.BoletaAsignados,
    (item) => item.BoletaUID,
    { predicate: (item) => item.Activo !== false },
  );
  const evidencesByTicket = groupRowsBy(
    tables.EvidenciasBoleta,
    (item) => item.BoletaUID,
    { predicate: (item) => item.Activo !== false },
  );
  const visits = group.visits.map((visit) => ({
    ...visit,
    GrupoVisitaID: ticketGroupId(visit),
    BoletaPrincipalUID: ticketRootId(visit),
    NumeroVisita: ticketVisitNumber(visit),
    EsVisitaPrincipal: clean(visit.BoletaUID) === clean(group.rootId),
    asignados: assignedView(visit.BoletaUID, assignmentsByTicket, usersById),
    evidenceCount: (evidencesByTicket.get(clean(visit.BoletaUID)) || []).length,
  }));
  const rawCurrent = group.visits.find((visit) => clean(visit.BoletaUID) === clean(ticket.BoletaUID)) || ticket;
  const current = {
    ...rawCurrent,
    ...ticket,
    GrupoVisitaID: ticketGroupId(rawCurrent),
    BoletaPrincipalUID: ticketRootId(rawCurrent),
    NumeroVisita: ticketVisitNumber(rawCurrent),
    EsVisitaPrincipal: clean(rawCurrent.BoletaUID) === clean(group.rootId),
  };

  return {
    ...(bundle?.boleta ? bundle : {}),
    boleta: current,
    asignados: bundle?.asignados || assignedView(current.BoletaUID, assignmentsByTicket, usersById),
    evidencias: bundle?.evidencias || evidencesByTicket.get(clean(current.BoletaUID)) || [],
    grupoVisitas: { ...groupSummary(group), visits },
    visitasRelacionadas: visits,
  };
}
