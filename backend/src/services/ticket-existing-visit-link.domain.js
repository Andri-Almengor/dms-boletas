function clean(value) {
  return String(value ?? '').trim();
}

function status(value) {
  const normalized = clean(value).toUpperCase();
  if (normalized.includes('FINAL')) return 'FINALIZADA';
  if (normalized.includes('PEND')) return 'PENDIENTE';
  if (normalized.includes('ANUL')) return 'ANULADA';
  return normalized;
}

function groupId(ticket = {}) {
  return clean(ticket.GrupoVisitaID || ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

function rootId(ticket = {}) {
  return clean(ticket.BoletaPrincipalUID || ticket.BoletaUID);
}

function visitNumber(ticket = {}) {
  const numeric = Number(ticket.NumeroVisita || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function active(ticket = {}) {
  return ticket.Activo !== false && clean(ticket.Activo || 'true').toLowerCase() !== 'false';
}

function ticketNumber(ticket = {}) {
  const numeric = Number(ticket.BoletaID || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function relatedRows(rows, ticket) {
  const selectedGroupId = groupId(ticket);
  const selectedRootId = rootId(ticket);
  return rows.filter((row) => (
    groupId(row) === selectedGroupId
    || clean(row.BoletaUID) === selectedRootId
    || clean(row.BoletaPrincipalUID) === selectedRootId
  ));
}

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sortCandidates(rows = []) {
  return [...rows].sort((left, right) => {
    const byDate = clean(left.Fecha).localeCompare(clean(right.Fecha));
    if (byDate) return byDate;
    const byNumber = ticketNumber(left) - ticketNumber(right);
    if (byNumber) return byNumber;
    return clean(left.BoletaUID).localeCompare(clean(right.BoletaUID));
  });
}

export function buildExistingVisitLinkPlan({
  rows = [],
  targetGroup,
  selectedIds = [],
  actor = 'SISTEMA',
  timestamp = new Date().toISOString(),
} = {}) {
  if (!targetGroup?.rootId || !targetGroup?.root) {
    throw validationError('TARGET_GROUP_INVALID', 'No fue posible identificar el seguimiento actual.');
  }
  if (!targetGroup.visits?.length || targetGroup.visits.some((visit) => status(visit.Estado) !== 'PENDIENTE')) {
    throw validationError('TARGET_GROUP_NOT_PENDING', 'Solo se pueden agregar boletas a un seguimiento que esté completamente pendiente.');
  }

  const targetClientId = clean(targetGroup.root.ClienteID);
  if (!targetClientId) {
    throw validationError('TARGET_CLIENT_MISSING', 'La boleta actual no tiene un cliente válido para relacionar visitas.');
  }

  const uniqueIds = [...new Set((selectedIds || []).map(clean).filter(Boolean))];
  if (!uniqueIds.length) {
    throw validationError('NO_TICKETS_SELECTED', 'Seleccione al menos una boleta para relacionar.');
  }
  if (uniqueIds.length > 50) {
    throw validationError('TOO_MANY_TICKETS', 'Puede relacionar hasta 50 boletas en una sola operación.');
  }

  const targetIds = new Set(targetGroup.visits.map((visit) => clean(visit.BoletaUID)));
  const alreadyLinkedIds = uniqueIds.filter((id) => targetIds.has(id));
  const requestedIds = uniqueIds.filter((id) => !targetIds.has(id));
  const candidates = [];

  for (const id of requestedIds) {
    const ticket = rows.find((row) => clean(row.BoletaUID) === id);
    if (!ticket || !active(ticket)) {
      throw validationError('TICKET_NOT_FOUND', 'Una de las boletas seleccionadas ya no está disponible.');
    }
    if (status(ticket.Estado) !== 'PENDIENTE') {
      throw validationError('TICKET_NOT_PENDING', `La boleta #${ticket.BoletaID || id} ya no está pendiente.`);
    }
    if (clean(ticket.ClienteID) !== targetClientId) {
      throw validationError('CLIENT_MISMATCH', `La boleta #${ticket.BoletaID || id} pertenece a otro cliente y no puede agregarse a este seguimiento.`);
    }

    const members = relatedRows(rows, ticket);
    if (members.length > 1) {
      throw validationError('TICKET_ALREADY_GROUPED', `La boleta #${ticket.BoletaID || id} ya pertenece a otro seguimiento de visitas.`);
    }
    candidates.push(ticket);
  }

  let nextVisitNumber = targetGroup.visits.reduce(
    (maximum, visit) => Math.max(maximum, visitNumber(visit)),
    0,
  );
  const orderedCandidates = sortCandidates(candidates);
  const updates = orderedCandidates.map((ticket) => {
    nextVisitNumber += 1;
    return {
      idValue: clean(ticket.BoletaUID),
      patch: {
        GrupoVisitaID: clean(targetGroup.id || targetGroup.rootId),
        BoletaPrincipalUID: clean(targetGroup.rootId),
        NumeroVisita: nextVisitNumber,
        EsVisitaPrincipal: false,
        Version: Number(ticket.Version || 0) + 1,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    };
  });

  if (updates.length) {
    updates.push({
      idValue: clean(targetGroup.rootId),
      patch: {
        Version: Number(targetGroup.root.Version || 0) + 1,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    });
  }

  return {
    updates,
    linkedIds: orderedCandidates.map((ticket) => clean(ticket.BoletaUID)),
    alreadyLinkedIds,
    targetClientId,
  };
}
