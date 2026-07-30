import { pick, toBoolean } from '../../services/moduleApi';

export const TICKET_FORM_STEPS = [
  ['Información general', 'Título, categoría, tipo de falla, fecha y horas.'],
  ['Cliente y ubicación', 'Cliente, ubicación, supervisor y correos.'],
  ['Dispositivo', 'Tipo, nombre del dispositivo, fabricante, modelo y serie.'],
  ['Trabajo realizado', 'Motivo, pruebas, resultado y recomendaciones.'],
  ['Técnicos', 'Seleccione una o varias personas asignadas.'],
  ['Evidencias', 'Capture fotografías o seleccione archivos.'],
  ['Firma', 'Firma de conformidad con dedo, mouse o lápiz.'],
  ['Revisión y envío', 'Confirme los datos y elija la acción final.'],
];

export function createEmptyTicketForm(date = new Date().toISOString().slice(0, 10)) {
  return {
    titulo: '', categoriaId: '', categoria: '', tipoFallaId: '', tipoFalla: '',
    fecha: date, horaInicio: '', horaFinal: '', horasTotales: '0.00',
    clienteId: '', cliente: '', ubicacionId: '', ubicacion: '', ubicacionEquipoId: '', ubicacionEquipo: '',
    supervisorId: '', supervisor: '', correoSupervisor: '', correoCliente: '',
    tipoDispositivoId: '', tipoDispositivo: '', fabricanteId: '', fabricante: '', modeloId: '', modelo: '',
    serie: '', nombreDispositivo: '', razonVisita: '', pruebasRealizadas: '', resultado: '', recomendaciones: '',
    asignados: [], firma: '', enviarCorreoCliente: false, correosCC: '',
  };
}

export function calculateTicketHours(start, end) {
  if (!start || !end) return '0.00';
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return '0.00';
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 1440;
  return (minutes / 60).toFixed(2);
}

export function ticketRecord(data) {
  return data?.boleta || data?.ticket || data || {};
}

export function mapTicketForm(data, emptyForm = createEmptyTicketForm()) {
  const row = ticketRecord(data);
  return {
    ...emptyForm,
    titulo: pick(row, ['Titulo', 'Título']),
    categoriaId: String(pick(row, ['CategoriaID'])),
    categoria: pick(row, ['Categoria']),
    tipoFallaId: String(pick(row, ['TipoFallaID'])),
    tipoFalla: pick(row, ['TipoFalla']),
    fecha: String(pick(row, ['Fecha'], emptyForm.fecha)).slice(0, 10),
    horaInicio: pick(row, ['HoraInicio']),
    horaFinal: pick(row, ['HoraFinal']),
    horasTotales: String(pick(row, ['HorasTotales'], '0.00')),
    clienteId: String(pick(row, ['ClienteID'])),
    cliente: pick(row, ['Cliente']),
    ubicacionId: String(pick(row, ['UbicacionID'])),
    ubicacion: pick(row, ['Ubicacion']),
    ubicacionEquipoId: String(pick(row, ['UbicacionEquipoID'])),
    ubicacionEquipo: pick(row, ['UbicacionEquipo']),
    supervisorId: String(pick(row, ['SupervisorID'])),
    supervisor: pick(row, ['Supervisor']),
    correoSupervisor: pick(row, ['CorreoSupervisor']),
    correoCliente: pick(row, ['CorreoCliente', 'Correo_Cliente']),
    tipoDispositivoId: String(pick(row, ['TipoDispositivoID'])),
    tipoDispositivo: pick(row, ['TipoDispositivo']),
    fabricanteId: String(pick(row, ['FabricanteID'])),
    fabricante: pick(row, ['Fabricante']),
    modeloId: String(pick(row, ['ModeloID'])),
    modelo: pick(row, ['Modelo']),
    serie: pick(row, ['Serie']),
    nombreDispositivo: pick(row, ['Descripcion', 'Descripción', 'DescripcionEquipo', 'NombreEquipo']),
    razonVisita: pick(row, ['RazonVisita', 'Razon_visita']),
    pruebasRealizadas: pick(row, ['PruebasRealizadas']),
    resultado: pick(row, ['Resultado']),
    recomendaciones: pick(row, ['Recomendaciones']),
    asignados: (data?.asignados || row.asignados || [])
      .map((item) => String(pick(item, ['UsuarioID', 'value'], item)))
      .filter(Boolean),
    enviarCorreoCliente: toBoolean(pick(row, ['EnviarCorreoCliente'], false)),
    correosCC: pick(row, ['CorreosCC']),
  };
}

export function buildTicketPayload(form, boletaUid, estado = 'PENDIENTE') {
  return {
    boletaUid,
    estado,
    ...form,
    horasTotales: Number(form.horasTotales || 0),
    Titulo: form.titulo,
    CategoriaID: form.categoriaId,
    Categoria: form.categoria,
    TipoFallaID: form.tipoFallaId,
    TipoFalla: form.tipoFalla,
    Fecha: form.fecha,
    HoraInicio: form.horaInicio,
    HoraFinal: form.horaFinal,
    HorasTotales: Number(form.horasTotales || 0),
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
  if (index === 4 && !(form.asignados || []).length) return 'Seleccione al menos un técnico.';
  return '';
}
