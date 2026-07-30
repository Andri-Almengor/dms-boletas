import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildTicketFormOptions,
  buildTicketPayload,
  buildTicketTechnicians,
  calculateTicketHours,
  EMPTY_TICKET_FORM,
  mapTicketForm,
  TICKET_FORM_STEPS,
  validateTicketForm,
  validateTicketStep,
} from '../../src/features/tickets/ticketFormDomain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function validForm() {
  return {
    ...EMPTY_TICKET_FORM,
    asignados: ['USR-1'],
    titulo: 'Mantenimiento preventivo',
    categoriaId: 'CAT-1',
    tipoFallaId: 'FALLA-1',
    fecha: '2026-07-30',
    clienteId: 'CLI-1',
    tipoDispositivoId: 'TIPO-1',
    nombreDispositivo: 'Cámara principal',
  };
}

test('calcula horas normales y cruces de medianoche con el contrato histórico', () => {
  assert.equal(calculateTicketHours('08:00', '10:30'), '2.50');
  assert.equal(calculateTicketHours('23:30', '01:00'), '1.50');
  assert.equal(calculateTicketHours('', '01:00'), '0.00');
  assert.equal(calculateTicketHours('incorrecto', '01:00'), '0.00');
});

test('normaliza una boleta histórica sin cambiar nombres ni asignaciones', () => {
  const form = mapTicketForm({
    boleta: {
      Título: 'Incidente de acceso',
      CategoriaID: 'CAT-9',
      TipoFallaID: 'F-2',
      Fecha: '2026-07-29T12:00:00.000Z',
      ClienteID: 'CLI-4',
      Correo_Cliente: 'cliente@example.com',
      Descripción: 'Puerta norte',
      Razon_visita: 'Revisión solicitada',
      EnviarCorreoCliente: 'Sí',
    },
    asignados: [{ UsuarioID: 'USR-1' }, { value: 'USR-2' }],
  });

  assert.equal(form.titulo, 'Incidente de acceso');
  assert.equal(form.fecha, '2026-07-29');
  assert.equal(form.correoCliente, 'cliente@example.com');
  assert.equal(form.nombreDispositivo, 'Puerta norte');
  assert.equal(form.razonVisita, 'Revisión solicitada');
  assert.equal(form.enviarCorreoCliente, true);
  assert.deepEqual(form.asignados, ['USR-1', 'USR-2']);
});

test('construye el payload dual requerido por frontend y backend', () => {
  const form = {
    ...validForm(),
    categoria: 'Soporte',
    tipoFalla: 'Sin video',
    cliente: 'Cliente Uno',
    nombreDispositivo: 'Cámara 01',
    horasTotales: '2.50',
    enviarCorreoCliente: true,
  };
  const payload = buildTicketPayload(form, 'BOL-1');

  assert.equal(payload.boletaUid, 'BOL-1');
  assert.equal(payload.estado, 'PENDIENTE');
  assert.equal(payload.Estado, 'PENDIENTE');
  assert.equal(payload.horasTotales, 2.5);
  assert.equal(payload.HorasTotales, 2.5);
  assert.equal(payload.Descripcion, 'Cámara 01');
  assert.equal(payload.AsignadoA, form.asignados);
  assert.equal(payload.EnviarCorreoCliente, true);
});

test('mantiene las validaciones y mensajes de los ocho pasos', () => {
  const form = validForm();
  assert.equal(TICKET_FORM_STEPS.length, 8);
  assert.equal(validateTicketForm(form), '');

  assert.equal(validateTicketStep({ ...form, titulo: '' }, 0), 'Complete título, categoría, tipo de falla y fecha.');
  assert.equal(validateTicketStep({ ...form, clienteId: '' }, 1), 'Seleccione un cliente.');
  assert.equal(validateTicketStep({ ...form, nombreDispositivo: '' }, 2), 'Seleccione el tipo y escriba el nombre del dispositivo.');
  assert.equal(validateTicketStep({ ...form, asignados: [] }, 4), 'Seleccione al menos un técnico.');
});

test('filtra fabricantes, modelos, supervisores y técnicos sin cambiar etiquetas', () => {
  const catalogs = {
    clients: [{ ClienteID: 'CLI-1', Nombre: 'Cliente Uno' }],
    categories: [],
    failures: [],
    devices: [],
    manufacturers: [
      { FabricanteID: 'FAB-1', Nombre: 'Axis' },
      { FabricanteID: 'FAB-2', Nombre: 'Otro' },
    ],
    models: [
      { ModeloID: 'MOD-1', TipoDispositivoID: 'TIPO-1', FabricanteID: 'FAB-1', Nombre: 'P3265' },
      { ModeloID: 'MOD-2', TipoDispositivoID: 'TIPO-2', FabricanteID: 'FAB-1', Nombre: 'Ajeno' },
    ],
    relations: [{ TipoDispositivoID: 'TIPO-1', FabricanteID: 'FAB-1', Activo: true }],
    users: [],
  };

  const options = buildTicketFormOptions({
    catalogs,
    locations: [],
    equipmentLocations: [],
    contacts: [{ ContactoID: 'C-1', Nombre: 'Ana', Correo: 'ana@example.com', EsSupervisor: true }],
    form: { ...validForm(), fabricanteId: 'FAB-1' },
  });

  assert.deepEqual(options.manufacturers.map((item) => item.value), ['FAB-1']);
  assert.deepEqual(options.models.map((item) => item.value), ['MOD-1']);
  assert.equal(options.supervisors[0].label, 'Ana · ana@example.com');

  const technicians = buildTicketTechnicians([
    { UsuarioID: 'USR-1', NombreCompleto: 'Ana Mora', Correo: 'ana@example.com' },
  ]);
  assert.deepEqual(technicians[0], {
    value: 'USR-1',
    label: 'Ana Mora',
    note: 'ana@example.com',
    initials: 'AM',
  });
});

test('la página y los servicios conservan dominio, campos y codificación comunes', () => {
  const page = source('src/pages/tickets/TicketFormPage.jsx');
  const persistence = source('src/features/tickets/ticketPersistenceService.js');
  const persistenceHook = source('src/features/tickets/useTicketPersistence.js');

  assert.match(page, /features\/tickets\/ticketFormDomain/);
  assert.match(page, /components\/forms\/FormField/);
  assert.match(persistence, /utils\/fileEncoding/);
  assert.match(persistence, /buildTicketPayload/);
  assert.match(persistenceHook, /validateTicketForm/);
  assert.doesNotMatch(page, /function hours\(/);
  assert.doesNotMatch(page, /function mapForm\(/);
  assert.doesNotMatch(page, /async function base64\(/);
});
