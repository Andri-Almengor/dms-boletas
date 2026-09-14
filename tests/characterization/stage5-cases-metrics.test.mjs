import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const casesSource = readFileSync(new URL('../../backend/src/modules/customer-cases.module.js', import.meta.url), 'utf8');
const metricsSource = readFileSync(new URL('../../backend/src/modules/metrics.module.js', import.meta.url), 'utf8');
const assignedHoursPatch = readFileSync(new URL('../../backend/src/services/metrics-assigned-hours.patch.js', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../../backend/src/core/action-router.js', import.meta.url), 'utf8');

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `No se encontró ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `No se encontró el final ${endMarker}`);
  return source.slice(start, end);
}

test('Etapa 5: Casos conserva normalización de estados y solo incluye registros activos en el listado', () => {
  const normalizeState = functionSource(casesSource, 'function normalizeState(', '\n}\n\nfunction parseArray');
  const list = functionSource(casesSource, '  list: async (ctx) => {', '\n\n  get: async (ctx) => {');

  assert.match(normalizeState, /\['EN_ESPERA', 'ESPERA', 'PENDIENTE'\]/);
  assert.match(normalizeState, /\['EN_PROCESO', 'PROCESO'\]/);
  assert.match(normalizeState, /\['FINALIZADO', 'FINALIZADA', 'FINAL'\]/);
  assert.match(normalizeState, /return 'EN_ESPERA'/);
  assert.match(list, /row\.Activo !== false/);
  assert.match(list, /\.map\(caseView\)/);
});

test('Etapa 5: Casos conserva filtros, búsqueda, orden, total y paginación históricos', () => {
  const list = functionSource(casesSource, '  list: async (ctx) => {', '\n\n  get: async (ctx) => {');

  assert.match(list, /pick\(ctx\.payload, \['status', 'estado'\]\)/);
  assert.match(list, /pick\(ctx\.payload, \['clientId', 'ClienteID'\]\)/);
  assert.match(list, /pick\(ctx\.payload, \['search', 'q'\]\)/);
  assert.match(list, /CasoNumero/);
  assert.match(list, /Cliente/);
  assert.match(list, /RazonVisita/);
  assert.match(list, /Problema/);
  assert.match(list, /NombreSolicitante/);
  assert.match(list, /CorreoSolicitante/);
  assert.match(list, /FechaCreacion/);
  assert.match(list, /const page = Math\.max\(1, Number\(ctx\.payload\.page \|\| 1\)\)/);
  assert.match(list, /Math\.min\(200, Math\.max\(1, Number\(ctx\.payload\.pageSize \|\| 60\)\)\)/);
  assert.match(list, /total:\s*rows\.length/);
});

test('Etapa 5: contadores de Casos siguen representando todos los casos activos, no solo la página filtrada', () => {
  const list = functionSource(casesSource, '  list: async (ctx) => {', '\n\n  get: async (ctx) => {');

  assert.match(list, /EN_ESPERA/);
  assert.match(list, /EN_PROCESO/);
  assert.match(list, /FINALIZADO/);
  assert.match(list, /TOTAL:/);
  const countsAt = list.indexOf('const counts =');
  const pageAt = list.indexOf('const page =');
  assert.ok(countsAt >= 0 && pageAt > countsAt, 'Los contadores globales deben resolverse antes de paginar.');
});

test('Etapa 5: el detalle de Caso conserva evidencias, técnicos, boleta y URL relacionada', () => {
  const detail = functionSource(casesSource, 'async function detailBundle(', '\n}\n\nasync function createPublicCase');

  assert.match(detail, /case:\s*item/);
  assert.match(detail, /evidences/);
  assert.match(detail, /technicians/);
  assert.match(detail, /ticket/);
  assert.match(detail, /ticketUrl:/);
  assert.match(detail, /NombreCompleto/);
  assert.match(detail, /NombreUsuario/);
  assert.match(detail, /Correo/);
});

test('Etapa 5: permisos de Casos permanecen administrativos y las rutas públicas siguen separadas', () => {
  assert.match(routerSource, /customerCases\.public\.get[\s\S]*customerCaseHandlers\.publicGet, null, true/);
  assert.match(routerSource, /customerCases\.public\.submit[\s\S]*customerCaseHandlers\.publicSubmit, null, true/);
  assert.match(routerSource, /customerCases\.list[\s\S]*customerCaseHandlers\.list, 'USUARIOS_GESTIONAR'/);
  assert.match(routerSource, /customerCases\.get[\s\S]*customerCaseHandlers\.get, 'USUARIOS_GESTIONAR'/);
  assert.match(routerSource, /customerCases\.process[\s\S]*customerCaseHandlers\.process, 'USUARIOS_GESTIONAR'/);
});

test('Etapa 5: Métricas de boletas conserva filtros y opciones independientes del subconjunto final', () => {
  const tickets = functionSource(metricsSource, 'async function ticketMetrics(', '\n}\n\nconst CATEGORY_CONFIG');

  for (const field of ['cliente', 'fecha', 'tipoFalla', 'estado', 'categoria', 'tecnico']) {
    assert.match(tickets, new RegExp(`${field}:`));
  }
  assert.match(tickets, /clientes:/);
  assert.match(tickets, /fechas:/);
  assert.match(tickets, /tiposFalla:/);
  assert.match(tickets, /categorias:/);
  assert.match(tickets, /tecnicos:/);
  assert.match(tickets, /estados:/);
  assert.match(tickets, /Sin asignar/);
});

test('Etapa 5: Métricas conserva totales, gráficas, detalle y límite de 300 boletas', () => {
  const tickets = functionSource(metricsSource, 'async function ticketMetrics(', '\n}\n\nconst CATEGORY_CONFIG');

  assert.match(tickets, /pendientes:/);
  assert.match(tickets, /finalizadas:/);
  assert.match(tickets, /enProceso:/);
  assert.match(tickets, /horasTotales:/);
  assert.match(tickets, /promedioHoras:/);
  assert.match(tickets, /porFecha:/);
  assert.match(tickets, /porTipoFalla:/);
  assert.match(tickets, /porEstado:/);
  assert.match(tickets, /porCategoria:/);
  assert.match(tickets, /detailRows:\s*details\.slice\(0, 300\)/);
  assert.match(tickets, /clean\(right\.fecha\)\.localeCompare\(clean\(left\.fecha\)/);
});

test('Etapa 5: la tabla final de horas conserva la política existente de horas completas por técnico', () => {
  const full = functionSource(assignedHoursPatch, 'async function fullAssignedHours(', '\n}\n\nif (!metricsHandlers[INSTALL_FLAG])');

  assert.match(full, /const hours = number\(row\.HorasTotales\)/);
  assert.match(full, /const recipients = assignees\.length \? assignees : \['Sin asignar'\]/);
  assert.match(full, /recipients\.forEach\(\(name\) => totals\.set\(name, number\(totals\.get\(name\)\) \+ hours\)\)/);
  assert.doesNotMatch(full, /hours\s*\/\s*assignees\.length/);
  assert.match(assignedHoursPatch, /tableAsignadoHoras:\s*await fullAssignedHours\(ctx\.payload \|\| \{\}\)/);
});
