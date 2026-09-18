import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCustomerCaseList,
  customerCaseView,
} from '../../backend/src/services/customer-case-query.service.js';
import {
  buildFullAssignedHours,
  buildTicketAssigneeIndex,
  buildTicketMetrics,
} from '../../backend/src/services/ticket-metrics-query.service.js';

const casesSource = readFileSync(new URL('../../backend/src/modules/customer-cases.module.js', import.meta.url), 'utf8');
const casePatchSource = readFileSync(new URL('../../backend/src/services/customer-case-query-optimization.patch.js', import.meta.url), 'utf8');
const metricsSource = readFileSync(new URL('../../backend/src/modules/metrics.module.js', import.meta.url), 'utf8');
const metricsQuerySource = readFileSync(new URL('../../backend/src/services/ticket-metrics-query.service.js', import.meta.url), 'utf8');
const assignedHoursPatch = readFileSync(new URL('../../backend/src/services/metrics-assigned-hours.patch.js', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../../backend/src/core/action-router.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../backend/src/app.js', import.meta.url), 'utf8');

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `No se encontró ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `No se encontró el final ${endMarker}`);
  return source.slice(start, end);
}

function counted(values, counter, key) {
  return {
    *[Symbol.iterator]() {
      for (const value of values) {
        counter[key] += 1;
        yield value;
      }
    },
  };
}

const CASE_ROWS = [
  {
    CasoID: 'C1', CasoNumero: 'CAS-000001', Estado: 'PENDIENTE', ClienteID: 'CL1', Cliente: 'Acme',
    RazonVisita: 'Cámara', Problema: 'Sin video', NombreSolicitante: 'Ana', CorreoSolicitante: 'ana@example.com',
    FechaCreacion: '2026-09-14T10:00:00.000Z', TecnicoIDsJSON: '[]', Activo: true,
  },
  {
    CasoID: 'C2', CasoNumero: 'CAS-000002', Estado: 'EN_PROCESO', ClienteID: 'CL1', Cliente: 'Acme',
    RazonVisita: 'Puerta', Problema: 'No abre', NombreSolicitante: 'Beto', CorreoSolicitante: 'beto@example.com',
    FechaCreacion: '2026-09-14T11:00:00.000Z', TecnicoIDsJSON: '["U1"]', Activo: true,
  },
  {
    CasoID: 'C3', CasoNumero: 'CAS-000003', Estado: 'FINALIZADA', ClienteID: 'CL2', Cliente: 'Beta',
    RazonVisita: 'Servidor', Problema: 'Alarma', NombreSolicitante: 'Carla', CorreoSolicitante: 'carla@example.com',
    FechaCreacion: '2026-09-13T09:00:00.000Z', TecnicoIDsJSON: 'U2', Activo: true,
  },
  {
    CasoID: 'C4', CasoNumero: 'CAS-000004', Estado: 'PENDIENTE', ClienteID: 'CL1', Cliente: 'Acme',
    RazonVisita: 'Inactivo', Problema: 'No debe contar', FechaCreacion: '2026-09-15T09:00:00.000Z', Activo: false,
  },
];

const USERS = [
  { UsuarioID: 'U1', NombreCompleto: 'Alice' },
  { UsuarioID: 'U2', NombreCompleto: 'Bob' },
];
const ASSIGNMENTS = [
  { BoletaUID: 'B1', UsuarioID: 'U1', Activo: true },
  { BoletaUID: 'B1', UsuarioID: 'U2', Activo: true },
  { BoletaUID: 'B2', UsuarioID: 'U2', Activo: false },
];
const TICKETS = [
  {
    BoletaUID: 'B1', BoletaID: '1', Estado: 'PENDIENTE', Cliente: 'Acme', Fecha: '2026-09-14',
    TipoFalla: 'Red', Categoria: 'CCTV', HorasTotales: 4, Titulo: 'Uno', Activo: true,
  },
  {
    BoletaUID: 'B2', BoletaID: '2', Estado: 'FINALIZADA', Cliente: 'Acme', Fecha: '2026-09-14',
    TipoFalla: 'Energía', Categoria: 'Acceso', HorasTotales: 2, Titulo: 'Dos', AsignadoA: 'Legacy', Activo: true,
  },
  {
    BoletaUID: 'B3', BoletaID: '3', Estado: 'EN_PROCESO', Cliente: 'Beta', Fecha: '2026-09-13',
    TipoFalla: 'Otro', Categoria: '', HorasTotales: 3, Titulo: 'Tres', Activo: true,
  },
  {
    BoletaUID: 'B4', BoletaID: '4', Estado: 'ANULADA', Cliente: 'Acme', Fecha: '2026-09-14',
    TipoFalla: 'Red', Categoria: 'CCTV', HorasTotales: 99, Activo: true,
  },
];

test('Etapa 5: Casos conserva normalización de estados y solo incluye registros activos', () => {
  const normalizeState = functionSource(casesSource, 'function normalizeState(', '\n}\n\nfunction parseArray');
  assert.match(normalizeState, /\['EN_ESPERA', 'ESPERA', 'PENDIENTE'\]/);
  assert.match(normalizeState, /\['EN_PROCESO', 'PROCESO'\]/);
  assert.match(normalizeState, /\['FINALIZADO', 'FINALIZADA', 'FINAL'\]/);
  assert.match(normalizeState, /return 'EN_ESPERA'/);

  assert.equal(customerCaseView(CASE_ROWS[0]).Estado, 'EN_ESPERA');
  assert.equal(customerCaseView(CASE_ROWS[2]).Estado, 'FINALIZADO');
  assert.equal(customerCaseView(CASE_ROWS[3]).Activo, false);
});

test('Etapa 5: listado de Casos conserva filtros, contadores globales, orden, total y paginación', () => {
  const result = buildCustomerCaseList(CASE_ROWS, {
    state: 'pendiente',
    clientId: 'CL1',
    search: 'acme',
    page: 1,
    pageSize: 1,
  });

  assert.deepEqual(result.counts, { EN_ESPERA: 1, EN_PROCESO: 1, FINALIZADO: 1, TOTAL: 3 });
  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 1);
  assert.deepEqual(result.items.map((row) => row.CasoID), ['C1']);

  const ordered = buildCustomerCaseList(CASE_ROWS, { page: 1, pageSize: 10 });
  assert.deepEqual(ordered.items.map((row) => row.CasoID), ['C2', 'C1', 'C3']);
});

test('Etapa 5: Casos conserva resultados y delega paginación/contadores a PostgreSQL', () => {
  const counter = { rows: 0 };
  const result = buildCustomerCaseList(counted(CASE_ROWS, counter, 'rows'), { page: 1, pageSize: 60 });
  assert.equal(counter.rows, CASE_ROWS.length);
  assert.equal(result.counts.TOTAL, 3);

  assert.match(casePatchSource, /customerCaseHandlers\.list\s*=\s*async/);
  assert.match(casePatchSource, /queryCustomerCasePage\(ctx\.payload\s*\|\|\s*\{\}\)/);
  assert.doesNotMatch(casePatchSource, /readTable\('CasosClientes'\)/);
});

test('Etapa 5: detalle de Caso conserva forma y usa búsquedas acotadas para relaciones', () => {
  assert.match(casePatchSource, /case:item/);
  assert.match(casePatchSource, /evidences/);
  assert.match(casePatchSource, /technicians/);
  assert.match(casePatchSource, /ticket/);
  assert.match(casePatchSource, /ticketUrl:/);
  assert.match(casePatchSource, /technicianIds\.size\?findRows\('Usuarios',\{UsuarioID:\[\.\.\.technicianIds\]\}/);
  assert.match(casePatchSource, /relatedTicketId\?findById\('Boletas',relatedTicketId\)/);
  assert.match(casePatchSource, /users\.filter\(\(user\)=>technicianIds\.has\(clean\(user\.UsuarioID\)\)\)/);
  assert.doesNotMatch(casePatchSource, /readTable\('Usuarios'\)|readTable\('Boletas'\)/);
});

test('Etapa 5: permisos de Casos permanecen administrativos y las rutas públicas siguen separadas', () => {
  assert.match(routerSource, /customerCases\.public\.get[\s\S]*customerCaseHandlers\.publicGet, null, true/);
  assert.match(routerSource, /customerCases\.public\.submit[\s\S]*customerCaseHandlers\.publicSubmit, null, true/);
  assert.match(routerSource, /customerCases\.list[\s\S]*customerCaseHandlers\.list, 'USUARIOS_GESTIONAR'/);
  assert.match(routerSource, /customerCases\.get[\s\S]*customerCaseHandlers\.get, 'USUARIOS_GESTIONAR'/);
  assert.match(routerSource, /customerCases\.process[\s\S]*customerCaseHandlers\.process, 'USUARIOS_GESTIONAR'/);
});

test('Etapa 5: índice de asignados recorre asignaciones una sola vez y conserva nombres/fallback', () => {
  const counter = { assignments: 0 };
  const index = buildTicketAssigneeIndex(counted(ASSIGNMENTS, counter, 'assignments'), USERS);
  assert.equal(counter.assignments, ASSIGNMENTS.length);
  assert.deepEqual(index.get('B1'), ['Alice', 'Bob']);
  assert.equal(index.has('B2'), false, 'Una asignación inactiva no debe reemplazar el fallback histórico de la boleta.');
  assert.match(metricsQuerySource, /for \(const row of assignments\)/);
  assert.doesNotMatch(metricsQuerySource, /assignments\s*\.filter/);
});

test('Etapa 5: Métricas de boletas conserva opciones y resultados exactos con filtro de cliente', () => {
  const result = buildTicketMetrics({ tickets: TICKETS, assignments: ASSIGNMENTS, users: USERS, payload: { cliente: 'Acme' } });

  assert.deepEqual(result.filtersApplied, {
    cliente: 'Acme', fecha: '', tipoFalla: '', estado: '', categoria: '', tecnico: '',
  });
  assert.deepEqual(result.options.clientes, ['Acme', 'Beta']);
  assert.deepEqual(result.options.fechas, ['2026-09-14']);
  assert.deepEqual(result.options.tiposFalla, ['Energía', 'Red']);
  assert.deepEqual(result.options.categorias, ['Acceso', 'CCTV']);
  assert.deepEqual(result.options.tecnicos, ['Alice', 'Bob', 'Legacy']);
  assert.deepEqual(result.totals, {
    total: 2, pendientes: 1, finalizadas: 1, enProceso: 0, horasTotales: 6, promedioHoras: 3,
  });
  assert.deepEqual(result.charts.porEstado, [['Pendiente', 1], ['Finalizado', 1], ['En proceso / otros', 0]]);
  assert.deepEqual(result.detailRows.map((row) => row.boletaUid), ['B2', 'B1']);
  assert.deepEqual(result.tableAsignadoHoras.map(({ asignadoA, horasTotales }) => [asignadoA, horasTotales]), [
    ['Alice', 2], ['Bob', 2], ['Legacy', 2],
  ]);
});

test('Etapa 5: Métricas recorre boletas una sola vez y acumula totales durante ese recorrido', () => {
  const counter = { tickets: 0 };
  const result = buildTicketMetrics({
    tickets: counted(TICKETS, counter, 'tickets'),
    assignments: ASSIGNMENTS,
    users: USERS,
    payload: {},
  });
  assert.equal(counter.tickets, TICKETS.length);
  assert.equal(result.totals.total, 3);
  assert.match(metricsQuerySource, /for \(const row of tickets\)/);
  assert.doesNotMatch(metricsQuerySource, /tickets\s*\.filter/);
});

test('Etapa 5: la tabla final de horas conserva horas completas por técnico y Sin asignar', () => {
  const result = buildFullAssignedHours({ tickets: TICKETS, assignments: ASSIGNMENTS, users: USERS, payload: {} });
  assert.deepEqual(result.map(({ asignadoA, horasTotales }) => [asignadoA, horasTotales]), [
    ['Alice', 4], ['Bob', 4], ['Sin asignar', 3], ['Legacy', 2],
  ]);

  const aliceOnly = buildFullAssignedHours({
    tickets: TICKETS,
    assignments: ASSIGNMENTS,
    users: USERS,
    payload: { tecnico: 'Alice' },
  });
  assert.deepEqual(aliceOnly.map(({ asignadoA, horasTotales }) => [asignadoA, horasTotales]), [
    ['Alice', 4], ['Bob', 4],
  ], 'El filtro selecciona boletas donde participa Alice; la política histórica acredita la boleta completa a todos sus asignados.');

  assert.match(assignedHoursPatch, /fullAssignedHours: true/);
  assert.match(assignedHoursPatch, /metrics-ticket-query-optimization\.patch\.js/);
  assert.doesNotMatch(assignedHoursPatch, /assignments\s*\.filter/);
});

test('Etapa 5: contratos históricos de métricas y límite de 300 detalles siguen presentes', () => {
  const tickets = functionSource(metricsSource, 'async function ticketMetrics(', '\n}\n\nconst CATEGORY_CONFIG');
  for (const field of ['cliente', 'fecha', 'tipoFalla', 'estado', 'categoria', 'tecnico']) assert.match(tickets, new RegExp(`${field}:`));
  assert.match(tickets, /detailRows:\s*details\.slice\(0, 300\)/);
  assert.match(tickets, /clean\(right\.fecha\)\.localeCompare\(clean\(left\.fecha\)/);
  assert.match(metricsQuerySource, /detailRows:\s*details\.slice\(0, 300\)/);
  assert.match(metricsQuerySource, /promedioHoras:/);
  assert.match(metricsQuerySource, /porFecha:/);
  assert.match(metricsQuerySource, /porTipoFalla:/);
  assert.match(metricsQuerySource, /porEstado:/);
  assert.match(metricsQuerySource, /porCategoria:/);
});

test('Etapa 5: los adaptadores se instalan antes de action-router y no alteran permisos', () => {
  const casePatchAt = appSource.indexOf("import './services/customer-case-query-optimization.patch.js';");
  const metricsPatchAt = appSource.indexOf("import './services/metrics-assigned-hours.patch.js';");
  const routerAt = appSource.indexOf("import { dispatchAction } from './core/action-router.js';");
  assert.ok(casePatchAt >= 0 && casePatchAt < routerAt);
  assert.ok(metricsPatchAt >= 0 && metricsPatchAt < routerAt);
  assert.match(casePatchSource, /customerCaseHandlers\.list\s*=\s*async/);
  assert.match(casePatchSource, /customerCaseHandlers\.get\s*=\s*async/);
});

test('métricas: horas completas reutilizan un recorrido y el índice de asignados', () => {
  for (const payload of [{}, { cliente: 'Acme' }, { tecnico: 'Bob' }, { estado: 'finalizado' }, { tecnico: 'Sin asignar' }]) {
    const input = { tickets: TICKETS, assignments: ASSIGNMENTS, users: USERS, payload };
    const expected = { ...buildTicketMetrics(input), tableAsignadoHoras: buildFullAssignedHours(input) };
    const counter = { tickets: 0, assignments: 0 };
    const actual = buildTicketMetrics({
      ...input,
      tickets: counted(TICKETS, counter, 'tickets'),
      assignments: counted(ASSIGNMENTS, counter, 'assignments'),
      fullAssignedHours: true,
    });
    assert.deepEqual(actual, expected);
    assert.equal(counter.tickets, TICKETS.length);
    assert.equal(counter.assignments, ASSIGNMENTS.length);
  }
});

test('métricas: handler de horas completas solicita los snapshots una sola vez', async () => {
  let calls = 0;
  const handlers = {};
  const source = assignedHoursPatch.replace(/^import .*;\n/gm, '');
  new Function('readTables', 'metricsHandlers', 'buildTicketMetrics', source)(async (names) => {
    calls += 1;
    assert.deepEqual(names, ['Boletas', 'BoletaAsignados', 'Usuarios']);
    return { Boletas: TICKETS, BoletaAsignados: ASSIGNMENTS, Usuarios: USERS };
  }, handlers, buildTicketMetrics);
  const result = await handlers.tickets({ payload: { cliente: 'Acme' } });
  assert.equal(calls, 1);
  assert.deepEqual(result.tableAsignadoHoras, buildFullAssignedHours({ tickets: TICKETS, assignments: ASSIGNMENTS, users: USERS, payload: { cliente: 'Acme' } }));
});


test('métricas: acumulación completa conserva valores numéricos extremos históricos', () => {
  const input = { tickets: [1e308, 1e308, 3].map(HorasTotales => ({ BoletaUID: 'B1', HorasTotales })), assignments: ASSIGNMENTS, users: USERS };
  assert.deepEqual(buildTicketMetrics({ ...input, fullAssignedHours: true }).tableAsignadoHoras, buildFullAssignedHours(input));
});
