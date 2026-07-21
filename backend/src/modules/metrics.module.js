import { readTables } from '../infra/sheets.repository.js';

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalized(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function active(row = {}) {
  return row.Activo !== false
    && String(row.Activo ?? 'true').toLowerCase() !== 'false'
    && normalized(row.Estado || 'ACTIVO') !== 'inactivo';
}

function dateOnly(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function increment(map, key, amount = 1) {
  const label = clean(key, 'Sin dato');
  map.set(label, (map.get(label) || 0) + amount);
}

function mapRows(map, limit = 0) {
  const rows = [...map.entries()]
    .sort((left, right) => right[1] - left[1] || clean(left[0]).localeCompare(clean(right[0]), 'es'))
    .map(([label, value]) => [clean(label, 'Sin dato'), round(value)]);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function chronologicalRows(map) {
  return [...map.entries()]
    .sort((left, right) => clean(left[0]).localeCompare(clean(right[0]), 'es'))
    .map(([label, value]) => [clean(label, 'Sin dato'), round(value)]);
}

function ticketStatusBucket(value) {
  const status = normalized(value);
  if (status.includes('pend')) return 'pendiente';
  if (status.includes('final')) return 'finalizado';
  return 'otro';
}

function ticketStatusLabel(bucket) {
  if (bucket === 'pendiente') return 'Pendiente';
  if (bucket === 'finalizado') return 'Finalizado';
  return 'En proceso / otros';
}

function matchesRequestedStatus(row, requested) {
  const expected = normalized(requested);
  if (!expected) return true;
  if (['pendiente', 'finalizado', 'otro'].includes(expected)) {
    return ticketStatusBucket(row.Estado) === expected;
  }
  return normalized(row.Estado) === expected;
}

function ticketAssignees(ticketId, assignments, usersById, ticket = {}) {
  const names = assignments
    .filter((row) => clean(row.BoletaUID) === clean(ticketId) && active(row))
    .map((row) => {
      const user = usersById.get(clean(row.UsuarioID));
      return clean(
        user?.NombreCompleto
          || user?.Nombre
          || user?.NombreUsuario
          || row.NombreUsuarioSnapshot
          || row.UsuarioID,
      );
    })
    .filter(Boolean);
  if (names.length) return uniqueSorted(names);
  return uniqueSorted(
    clean(ticket.AsignadoA || ticket.Asignado || ticket.Responsable)
      .split(/[;,]/)
      .map((value) => value.trim()),
  );
}

async function ticketMetrics({ payload = {} }) {
  const tables = await readTables(['Boletas', 'BoletaAsignados', 'Usuarios']);
  const allTickets = (tables.Boletas || []).filter((row) => active(row) && normalized(row.Estado) !== 'anulada');
  const usersById = new Map((tables.Usuarios || []).map((row) => [clean(row.UsuarioID), row]));

  const client = clean(payload.cliente || payload.Cliente);
  const date = dateOnly(payload.fecha || payload.Fecha);
  const failureType = clean(payload.tipoFalla || payload.TipoFalla);
  const status = clean(payload.estado || payload.Estado);

  const clientFiltered = client
    ? allTickets.filter((row) => normalized(row.Cliente) === normalized(client))
    : allTickets;
  const dateOptions = uniqueSorted(clientFiltered.map((row) => dateOnly(row.Fecha))).reverse();

  const rows = clientFiltered
    .filter((row) => !date || dateOnly(row.Fecha) === date)
    .filter((row) => !failureType || normalized(row.TipoFalla) === normalized(failureType))
    .filter((row) => matchesRequestedStatus(row, status));

  const totalHours = rows.reduce((sum, row) => sum + number(row.HorasTotales), 0);
  const statusCounts = { pendiente: 0, finalizado: 0, otro: 0 };
  const byDate = new Map();
  const byFailureType = new Map();
  const byCategory = new Map();
  const assignedHours = new Map();
  const details = [];

  for (const row of rows) {
    const bucket = ticketStatusBucket(row.Estado);
    statusCounts[bucket] += 1;
    increment(byDate, dateOnly(row.Fecha) || 'Sin fecha');
    increment(byFailureType, row.TipoFalla || 'Sin tipo de falla');
    increment(byCategory, row.Categoria || 'Sin categoría');

    const assignees = ticketAssignees(row.BoletaUID, tables.BoletaAsignados || [], usersById, row);
    const share = assignees.length ? number(row.HorasTotales) / assignees.length : 0;
    if (assignees.length) assignees.forEach((name) => increment(assignedHours, name, share));
    else increment(assignedHours, 'Sin asignar', number(row.HorasTotales));

    details.push({
      id: row.BoletaID || row.BoletaUID,
      boletaUid: row.BoletaUID,
      titulo: row.Titulo || 'Sin título',
      estado: row.Estado || 'Sin estado',
      fecha: dateOnly(row.Fecha),
      cliente: row.Cliente || 'Sin cliente',
      categoria: row.Categoria || 'Sin categoría',
      tipoFalla: row.TipoFalla || 'Sin tipo de falla',
      asignadoA: assignees.join(', ') || 'Sin asignar',
      horasTotales: round(row.HorasTotales),
      horaInicio: row.HoraInicio || '',
      horaFinalizacion: row.HoraFinal || '',
      ubicacion: row.Ubicacion || '',
      esMantenimiento: Boolean(row.EsBoletaMantenimiento || row.OrigenMantenimientoID),
    });
  }

  details.sort((left, right) => (
    clean(right.fecha).localeCompare(clean(left.fecha), 'es')
      || String(right.id).localeCompare(String(left.id), 'es')
  ));

  const failureOptions = uniqueSorted(clientFiltered.map((row) => row.TipoFalla));
  const clients = uniqueSorted(allTickets.map((row) => row.Cliente));

  return {
    filtersApplied: { cliente: client, fecha: date, tipoFalla: failureType, estado: normalized(status) },
    options: {
      clientes: clients,
      fechas: dateOptions,
      tiposFalla: failureOptions,
      estados: [
        { value: 'pendiente', label: 'Pendiente' },
        { value: 'finalizado', label: 'Finalizado' },
        { value: 'otro', label: 'En proceso / otros' },
      ],
    },
    totals: {
      total: rows.length,
      pendientes: statusCounts.pendiente,
      finalizadas: statusCounts.finalizado,
      enProceso: statusCounts.otro,
      horasTotales: round(totalHours),
      promedioHoras: rows.length ? round(totalHours / rows.length) : 0,
    },
    charts: {
      porFecha: chronologicalRows(byDate),
      porTipoFalla: mapRows(byFailureType, 12),
      porEstado: [
        [ticketStatusLabel('pendiente'), statusCounts.pendiente],
        [ticketStatusLabel('finalizado'), statusCounts.finalizado],
        [ticketStatusLabel('otro'), statusCounts.otro],
      ],
      porCategoria: mapRows(byCategory, 12),
    },
    tableAsignadoHoras: [...assignedHours.entries()]
      .sort((left, right) => right[1] - left[1] || clean(left[0]).localeCompare(clean(right[0]), 'es'))
      .map(([asignadoA, horasTotales], index) => ({ index: index + 1, asignadoA: clean(asignadoA, 'Sin asignar'), horasTotales: round(horasTotales) })),
    detailRows: details.slice(0, 300),
  };
}

const CATEGORY_CONFIG = [
  { label: 'Cámaras', field: 'CantCámaras', aliases: ['camara', 'camaras'] },
  { label: 'Puertas', field: 'CantPuertas', aliases: ['puerta', 'puertas'] },
  { label: 'Servidor', field: 'CantServidores', aliases: ['servidor', 'servidores'] },
  { label: 'Grabador', field: 'CantGrabadores', aliases: ['grabador', 'grabadores'] },
  { label: 'Bocinas', field: 'CantBocinas', aliases: ['bocina', 'bocinas'] },
  { label: 'Sensor Perimetral', field: 'CantSensoresPerimetrales', aliases: ['sensor perimetral', 'sensores perimetrales'] },
  { label: 'Sensor Movimiento', field: 'CantSensoresMovimiento', aliases: ['sensor movimiento', 'sensor de movimiento', 'sensores movimiento'] },
  { label: 'Sensor de Ruptura', field: 'CantSensorRuptura', aliases: ['sensor de ruptura', 'sensor ruptura'] },
  { label: 'Impresora', field: 'CantImpresora', aliases: ['impresora', 'impresoras'] },
  { label: 'Gabinete', field: 'CantGabinetes', aliases: ['gabinete', 'gabinetes'] },
  { label: 'VideoWall', field: 'CantVideoWall', aliases: ['videowall', 'video wall'] },
];

function categoryLabel(value) {
  const current = normalized(value);
  const match = CATEGORY_CONFIG.find((item) => item.aliases.some((alias) => current === normalized(alias)));
  return match?.label || clean(value, 'Sin categoría');
}

function expectedCounts(maintenance = {}) {
  let json = {};
  try {
    json = typeof maintenance.CantidadesJSON === 'string'
      ? JSON.parse(maintenance.CantidadesJSON || '{}')
      : (maintenance.CantidadesJSON || {});
  } catch {
    json = {};
  }
  const result = new Map();
  CATEGORY_CONFIG.forEach((item) => {
    const amount = number(json[item.field] ?? maintenance[item.field]);
    if (amount > 0) result.set(item.label, amount);
  });
  return result;
}

function positive(value) {
  const text = normalized(value);
  return text === 'si' || text.startsWith('si ') || text.includes('funciona') || text.includes('correcto');
}

function stored(value) {
  const text = normalized(value);
  return text.includes('guardad') || (text.startsWith('no') && !text.includes('uso'));
}

async function maintenanceMetrics({ payload = {} }) {
  const tables = await readTables([
    'Mantenimiento',
    'Evidencia_Mantenimientos',
    'Mantenimiento imagenes',
    'Usuarios',
  ]);
  const allMaintenances = (tables.Mantenimiento || []).filter(active);
  const allDevices = (tables.Evidencia_Mantenimientos || []).filter(active);
  const allImages = (tables['Mantenimiento imagenes'] || []).filter(active);
  const usersById = new Map((tables.Usuarios || []).map((row) => [clean(row.UsuarioID), row]));

  const client = clean(payload.cliente || payload.Cliente);
  const date = dateOnly(payload.fecha || payload.Fecha);
  const functioning = clean(payload.funcionamiento || payload.Funcionamiento);
  const inUse = clean(payload.enUso || payload.EnUso);

  const clientFiltered = client
    ? allMaintenances.filter((row) => normalized(row.Cliente) === normalized(client))
    : allMaintenances;
  const selectedMaintenances = clientFiltered.filter((row) => !date || dateOnly(row.Fecha) === date);
  const maintenanceIds = new Set(selectedMaintenances.map((row) => clean(row.MantenimientoID)));
  const maintenanceById = new Map(selectedMaintenances.map((row) => [clean(row.MantenimientoID), row]));
  const selectedDevices = allDevices.filter((row) => maintenanceIds.has(clean(row.MantenimientoRef)));
  const filteredDevices = selectedDevices
    .filter((row) => !functioning || normalized(row.Funcionamiento) === normalized(functioning))
    .filter((row) => !inUse || normalized(row.EnUso) === normalized(inUse));

  const selectedDeviceIds = new Set(selectedDevices.map((row) => clean(row.EvidenciaMantenimientoID)));
  const evidenceCount = allImages.filter((row) => selectedDeviceIds.has(clean(row.DispositivoMantenimientoRef))).length;
  const imageCountByDevice = new Map();
  allImages.forEach((row) => {
    const id = clean(row.DispositivoMantenimientoRef);
    if (selectedDeviceIds.has(id)) increment(imageCountByDevice, id);
  });

  const expectedByCategory = new Map();
  selectedMaintenances.forEach((maintenance) => {
    expectedCounts(maintenance).forEach((amount, label) => increment(expectedByCategory, label, amount));
  });
  const registeredByCategory = new Map();
  selectedDevices.forEach((device) => increment(registeredByCategory, categoryLabel(device.Categoria || device.TipoDispositivo)));

  const categoryLabels = uniqueSorted([...expectedByCategory.keys(), ...registeredByCategory.keys()]);
  const categorySummary = categoryLabels.map((categoria) => {
    const totalEsperado = number(expectedByCategory.get(categoria));
    const registrados = number(registeredByCategory.get(categoria));
    const faltantes = Math.max(0, totalEsperado - registrados);
    return {
      categoria,
      totalEsperado,
      registrados,
      faltantes,
      porcentaje: totalEsperado ? Math.min(100, Math.round((registrados / totalEsperado) * 100)) : (registrados ? 100 : 0),
    };
  }).sort((left, right) => right.totalEsperado - left.totalEsperado || clean(left.categoria).localeCompare(clean(right.categoria), 'es'));

  const totalExpected = [...expectedByCategory.values()].reduce((sum, value) => sum + number(value), 0);
  const registered = selectedDevices.length;
  const missing = Math.max(0, totalExpected - registered);
  const byFunctioning = new Map();
  const byUse = new Map();
  filteredDevices.forEach((row) => {
    increment(byFunctioning, row.Funcionamiento || 'Sin dato');
    increment(byUse, row.EnUso || 'Sin dato');
  });

  const details = filteredDevices.map((row) => {
    const maintenance = maintenanceById.get(clean(row.MantenimientoRef)) || {};
    const creator = usersById.get(clean(row.CreadoPor));
    return {
      deviceId: row.EvidenciaMantenimientoID,
      nombreDispositivo: row.NombreDispositivo || 'Sin dispositivo',
      zona: row.Zona || 'Sin zona',
      categoria: categoryLabel(row.Categoria || row.TipoDispositivo),
      funcionamiento: row.Funcionamiento || 'Sin dato',
      enUso: row.EnUso || 'Sin dato',
      estado: row.Estado || '',
      observacion: row.Observacion || '',
      fechaRegistro: dateOnly(row.FechaTrabajo || row.FechaCreacion),
      hora: clean(row.FechaCreacion).split('T')[1]?.slice(0, 5) || '',
      creador: clean(creator?.NombreCompleto || creator?.Nombre || creator?.NombreUsuario || row.Tecnicos || row.CreadoPor, 'Sin responsable'),
      mantenimientoId: maintenance.MantenimientoID,
      tituloMantenimiento: maintenance.TituloMantenimiento || 'Sin título',
      estadoMantenimiento: maintenance.Estado || 'Sin estado',
      cliente: maintenance.Cliente || 'Sin cliente',
      fechaMantenimiento: dateOnly(maintenance.Fecha),
      evidencias: number(imageCountByDevice.get(clean(row.EvidenciaMantenimientoID))),
      operativo: positive(row.Funcionamiento),
      almacenado: stored(row.EnUso),
    };
  }).sort((left, right) => (
    clean(right.fechaMantenimiento).localeCompare(clean(left.fechaMantenimiento), 'es')
      || clean(left.nombreDispositivo).localeCompare(clean(right.nombreDispositivo), 'es')
  ));

  const operating = filteredDevices.filter((row) => positive(row.Funcionamiento)).length;
  const failing = filteredDevices.length - operating;
  const activeUse = filteredDevices.filter((row) => !stored(row.EnUso) && normalized(row.EnUso).includes('uso')).length;
  const storedCount = filteredDevices.filter((row) => stored(row.EnUso)).length;

  return {
    filtersApplied: { cliente: client, fecha: date, funcionamiento: functioning, enUso: inUse },
    options: {
      clientes: uniqueSorted(allMaintenances.map((row) => row.Cliente)),
      fechas: uniqueSorted(clientFiltered.map((row) => dateOnly(row.Fecha))).reverse(),
      funcionamiento: uniqueSorted(selectedDevices.map((row) => row.Funcionamiento)),
      enUso: uniqueSorted(selectedDevices.map((row) => row.EnUso)),
    },
    totals: {
      mantenimientos: selectedMaintenances.length,
      evidencias: evidenceCount,
      dispositivosEsperados: totalExpected,
      dispositivosRegistrados: registered,
      dispositivosFaltantes: missing,
      avance: totalExpected ? Math.min(100, Math.round((registered / totalExpected) * 100)) : (registered ? 100 : 0),
      dispositivosFiltrados: filteredDevices.length,
    },
    resumenCategorias: categorySummary,
    charts: {
      porFuncionamiento: mapRows(byFunctioning),
      porEnUso: mapRows(byUse),
      operating,
      failing,
      activeUse,
      stored: storedCount,
    },
    detailRows: details.slice(0, 500),
  };
}

export const metricsHandlers = {
  tickets: ticketMetrics,
  maintenance: maintenanceMetrics,
};
