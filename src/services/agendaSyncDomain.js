function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function agendaId(item = {}) {
  return clean(item.AgendaID || item.agendaId || item.id);
}

function agendaItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function compareAgenda(left, right) {
  return clean(left?.Fecha).localeCompare(clean(right?.Fecha))
    || clean(left?.HoraInicio, '07:00').localeCompare(clean(right?.HoraInicio, '07:00'))
    || clean(left?.Detalle).localeCompare(clean(right?.Detalle), 'es');
}

export function agendaMatchesSyncQuery(item = {}, request = {}, permissions = []) {
  const from = clean(request.from || request.desde || request.fechaInicio);
  const to = clean(request.to || request.hasta || request.fechaFin);
  const date = clean(item.Fecha).slice(0, 10);
  if (from && date < from.slice(0, 10)) return false;
  if (to && date > to.slice(0, 10)) return false;

  const requestedUserId = clean(request.usuarioId || request.userId || request.UsuarioID);
  if (requestedUserId && permissions.includes('USUARIOS_GESTIONAR')) {
    const assigned = Array.isArray(item.asignados) ? item.asignados : [];
    if (!assigned.some((user) => clean(user?.UsuarioID) === requestedUserId)) return false;
  }

  const search = normalized(request.search || request.q);
  if (search) {
    const assigned = Array.isArray(item.asignados) ? item.asignados : [];
    const haystack = normalized([
      item.Detalle,
      item.ClienteNombre,
      item.Fecha,
      ...assigned.map((user) => `${user?.NombreCompleto || ''} ${user?.NombreUsuario || ''} ${user?.Correo || ''}`),
    ].join(' '));
    if (!haystack.includes(search)) return false;
  }
  return true;
}

export function patchAgendaCollection(data, request = {}, delta = {}, permissions = []) {
  const removed = new Set((delta.removed || []).map(clean).filter(Boolean));
  const items = agendaItems(data).filter((item) => !removed.has(agendaId(item)));
  const byId = new Map(items.map((item, index) => [agendaId(item), index]).filter(([id]) => Boolean(id)));

  for (const incoming of delta.upserts || []) {
    const id = agendaId(incoming);
    if (!id) continue;
    const currentIndex = byId.has(id) ? byId.get(id) : -1;
    const matches = agendaMatchesSyncQuery(incoming, request, permissions);

    if (!matches) {
      if (currentIndex >= 0) {
        items.splice(currentIndex, 1);
        byId.clear();
        items.forEach((item, index) => byId.set(agendaId(item), index));
      }
      continue;
    }

    if (currentIndex >= 0) items[currentIndex] = { ...items[currentIndex], ...incoming };
    else items.push(incoming);
    byId.clear();
    items.forEach((item, index) => byId.set(agendaId(item), index));
  }

  items.sort(compareAgenda);
  if (Array.isArray(data)) return items;
  const base = { ...data, total: items.length, syncIntegrityPending: false };
  if (Array.isArray(data?.rows)) return { ...base, rows: items };
  if (Array.isArray(data?.data)) return { ...base, data: items };
  return { ...base, items };
}
