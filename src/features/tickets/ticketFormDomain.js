import { normalizeMacAddress } from '../../utils/macAddress';

export const TICKET_FORM_STEPS = Object.freeze([
  ['Información general', 'Título, categoría, tipo de falla, fecha y horas.'],
  ['Cliente y ubicación', 'Cliente, ubicación, supervisor y correos.'],
  ['Dispositivo', 'Tipo, nombre del dispositivo, fabricante, modelo, serie y dirección MAC.'],
  ['Trabajo realizado', 'Motivo, pruebas, resultado y recomendaciones.'],
  ['Técnicos', 'Seleccione una o varias personas asignadas.'],
  ['Evidencias', 'Capture fotografías, videos cortos o seleccione archivos.'],
  ['Firma', 'Firma de conformidad con dedo, mouse o lápiz.'],
  ['Revisión y envío', 'Confirme los datos y elija la acción final.'],
]);

export const EMPTY_TICKET_FORM = Object.freeze({
  titulo: '', categoriaId: '', categoria: '', tipoFallaId: '', tipoFalla: '',
  fecha: new Date().toISOString().slice(0, 10), horaInicio: '', horaFinal: '', horasTotales: '0.00',
  clienteId: '', cliente: '', ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '',
  supervisorId: '', supervisor: '', correoSupervisor: '', correoCliente: '',
  tipoDispositivoId: '', tipoDispositivo: '', fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
  serie: '', macAddress: '', nombreDispositivo: '', razonVisita: '', pruebasRealizadas: '', resultado: '', recomendaciones: '',
  asignados: [], firma: '', enviarCorreoCliente: false, correosCC: '',
});

export const TICKET_FORM_IDS = Object.freeze({
  clients: ['ClienteID', 'ID', 'id'],
  categories: ['CategoriaID', 'ID', 'id'],
  failures: ['TipoFallaID', 'ID', 'id'],
  devices: ['TipoDispositivoID', 'ID', 'id'],
  manufacturers: ['FabricanteID', 'ID', 'id'],
  models: ['ModeloID', 'ID', 'id'],
});

function readValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].includes(String(value).trim().toLowerCase());
}

function optionFromRecord(record, valueKeys, labelKeys) {
  const value = readValue(record, [...valueKeys, 'RowID', 'Row ID', 'rowId', 'rowID']);
  const label = readValue(record, labelKeys, value);
  return value ? { value: String(value), label: String(label), record } : null;
}

export function calculateTicketHours(start, end) {
  if (!start || !end) return '0.00';
  const [startHour, startMinute] = String(start).split(':').map(Number);
  const [endHour, endMinute] = String(end).split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return '0.00';

  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 1440;
  return (minutes / 60).toFixed(2);
}

export function ticketRecordData(data) {
  return data?.boleta || data?.ticket || data || {};
}

export function mapTicketForm(data) {
  const row = ticketRecordData(data);
  return {
    ...EMPTY_TICKET_FORM,
    asignados: [],
    titulo: readValue(row, ['Titulo', 'Título']),
    categoriaId: String(readValue(row, ['CategoriaID'])),
    categoria: readValue(row, ['Categoria']),
    tipoFallaId: String(readValue(row, ['TipoFallaID'])),
    tipoFalla: readValue(row, ['TipoFalla']),
    fecha: String(readValue(row, ['Fecha'], EMPTY_TICKET_FORM.fecha)).slice(0, 10),
    horaInicio: readValue(row, ['HoraInicio']),
    horaFinal: readValue(row, ['HoraFinal']),
    horasTotales: String(readValue(row, ['HorasTotales'], '0.00')),
    clienteId: String(readValue(row, ['ClienteID'])),
    cliente: readValue(row, ['Cliente']),
    ubicacionId: String(readValue(row, ['UbicacionID'])),
    ubicacion: readValue(row, ['Ubicacion']),
    ubicacionEquipoId: String(readValue(row, ['UbicacionEquipoID'])),
    ubicacionEquipo: readValue(row, ['UbicacionEquipo']),
    supervisorId: String(readValue(row, ['SupervisorID'])),
    supervisor: readValue(row, ['Supervisor']),
    correoSupervisor: readValue(row, ['CorreoSupervisor']),
    correoCliente: readValue(row, ['CorreoCliente', 'Correo_Cliente']),
    tipoDispositivoId: String(readValue(row, ['TipoDispositivoID'])),
    tipoDispositivo: readValue(row, ['TipoDispositivo']),
    fabricanteId: String(readValue(row, ['FabricanteID'])),
    fabricante: readValue(row, ['Fabricante']),
    modeloId: String(readValue(row, ['ModeloID'])),
    modelo: readValue(row, ['Modelo']),
    serie: readValue(row, ['Serie']),
    macAddress: normalizeMacAddress(readValue(row, ['DireccionMAC', 'MACAddress', 'MacAddress', 'macAddress'])),
    nombreDispositivo: readValue(row, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']),
    razonVisita: readValue(row, ['RazonVisita', 'Razon_visita']),
    pruebasRealizadas: readValue(row, ['PruebasRealizadas']),
    resultado: readValue(row, ['Resultado']),
    recomendaciones: readValue(row, ['Recomendaciones']),
    asignados: (data?.asignados || row.asignados || [])
      .map((item) => String(readValue(item, ['UsuarioID', 'value'], item)))
      .filter(Boolean),
    enviarCorreoCliente: asBoolean(readValue(row, ['EnviarCorreoCliente'], false)),
    correosCC: readValue(row, ['CorreosCC']),
  };
}

export function buildTicketPayload(form, boletaUid, estado = 'PENDIENTE') {
  const totalHours = Number(form.horasTotales || 0);
  const macAddress = normalizeMacAddress(form.macAddress);
  return {
    boletaUid,
    estado,
    ...form,
    macAddress,
    horasTotales: totalHours,
    Titulo: form.titulo,
    CategoriaID: form.categoriaId,
    Categoria: form.categoria,
    TipoFallaID: form.tipoFallaId,
    TipoFalla: form.tipoFalla,
    Fecha: form.fecha,
    HoraInicio: form.horaInicio,
    HoraFinal: form.horaFinal,
    HorasTotales: totalHours,
    ClienteID: form.clienteId,
    Cliente: form.cliente,
    UbicacionID: form.ubicacionId,
    Ubicacion: form.ubicacion,
    UbicacionEquipoID: form.ubicacionEquipoId,
    UbicacionEquipo: form.ubicacionEquipo,
    SupervisorID: form.supervisorId,
    Supervisor: form.supervisor,
    CorreoSupervisor: form.correoSupervisor,
    CorreoCliente: form.correoCliente,
    TipoDispositivoID: form.tipoDispositivoId,
    TipoDispositivo: form.tipoDispositivo,
    FabricanteID: form.fabricanteId,
    Fabricante: form.fabricante,
    ModeloID: form.modeloId,
    Modelo: form.modelo,
    Serie: form.serie,
    DireccionMAC: macAddress,
    RazonVisita: form.razonVisita,
    Descripcion: form.nombreDispositivo,
    PruebasRealizadas: form.pruebasRealizadas,
    Resultado: form.resultado,
    Recomendaciones: form.recomendaciones,
    AsignadoA: form.asignados,
    EnviarCorreoCliente: form.enviarCorreoCliente,
    CorreosCC: form.correosCC,
    Estado: estado,
  };
}

export function validateTicketStep(form, index) {
  if (index === 0 && (!form.titulo || !form.categoriaId || !form.tipoFallaId || !form.fecha)) {
    return 'Complete título, categoría, tipo de falla y fecha.';
  }
  if (index === 1 && !form.clienteId) return 'Seleccione un cliente.';
  if (index === 2 && (!form.tipoDispositivoId || !String(form.nombreDispositivo || '').trim())) {
    return 'Seleccione el tipo y escriba el nombre del dispositivo.';
  }
  if (index === 4 && !form.asignados?.length) return 'Seleccione al menos un técnico.';
  return '';
}

export function validateTicketForm(form) {
  return TICKET_FORM_STEPS.map((_, index) => validateTicketStep(form, index)).find(Boolean) || '';
}

export function findTicketRecord(rows, value, keys) {
  return rows.find((row) => keys.some((key) => String(row?.[key] || '') === String(value || '')));
}

export function buildTicketFormOptions({ catalogs, locations, equipmentLocations, contacts, form }) {
  const makeOptions = (rows, valueKeys, labelKeys) => rows
    .map((row) => optionFromRecord(row, valueKeys, labelKeys))
    .filter(Boolean);

  const options = {
    clients: makeOptions(catalogs.clients, TICKET_FORM_IDS.clients, ['Nombre', 'Clientes', 'RazonSocial']),
    categories: makeOptions(catalogs.categories, TICKET_FORM_IDS.categories, ['Nombre']),
    failures: makeOptions(catalogs.failures, TICKET_FORM_IDS.failures, ['Nombre']),
    devices: makeOptions(catalogs.devices, TICKET_FORM_IDS.devices, ['Nombre']),
    locations: makeOptions(locations, ['UbicacionID', 'id'], ['Nombre']),
    equipment: makeOptions(equipmentLocations, ['UbicacionEquipoID', 'id'], ['Nombre']),
    supervisors: contacts
      .filter((item) => asBoolean(readValue(item, ['EsSupervisor'], true), true))
      .map((item) => {
        const option = optionFromRecord(item, ['ContactoID', 'id'], ['Nombre']);
        const email = readValue(item, ['Correo']);
        return option ? { ...option, label: `${option.label}${email ? ` · ${email}` : ''}` } : null;
      })
      .filter(Boolean),
  };

  const relationIds = catalogs.relations
    .filter((item) => String(readValue(item, ['TipoDispositivoID'])) === form.tipoDispositivoId
      && asBoolean(readValue(item, ['Activo'], true), true))
    .map((item) => String(readValue(item, ['FabricanteID'])));

  options.manufacturers = makeOptions(
    relationIds.length
      ? catalogs.manufacturers.filter((item) => relationIds.includes(String(readValue(item, ['FabricanteID']))))
      : catalogs.manufacturers,
    TICKET_FORM_IDS.manufacturers,
    ['Nombre'],
  );

  options.models = makeOptions(
    catalogs.models.filter((item) => (
      (!form.tipoDispositivoId || String(readValue(item, ['TipoDispositivoID'])) === form.tipoDispositivoId)
      && (!form.fabricanteId || String(readValue(item, ['FabricanteID'])) === form.fabricanteId)
    )),
    TICKET_FORM_IDS.models,
    ['Nombre'],
  );

  return options;
}

export function buildTicketTechnicians(users) {
  return users
    .map((item) => {
      const label = String(readValue(item, ['NombreCompleto', 'Nombre']));
      const parts = label.split(/\s+/);
      return {
        value: String(readValue(item, ['UsuarioID', 'id'])),
        label,
        note: readValue(item, ['Correo', 'NombreUsuario']),
        initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase(),
      };
    })
    .filter((item) => item.value && item.label);
}
