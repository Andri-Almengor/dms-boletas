import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  READ_ROUTE_CLASS,
  classifyReadRoute,
  readRouteInventory,
} from '../src/services/sync-read-route-inventory.js';
import { syncResourceRegistry } from '../src/services/sync-resource-registry.js';

const routerSource = await readFile(new URL('../src/core/action-router.js', import.meta.url), 'utf8');

const representativeRoutes = Object.freeze({
  [READ_ROUTE_CLASS.DELTA_SYNCED]: [
    'boletas.list', 'boletas.get', 'maintenance.list', 'maintenance.get',
    'agenda.list', 'agenda.get', 'clients.list', 'clientLocations.list',
    'equipmentLocations.list', 'contacts.list', 'catalog.models.list',
    'customerCases.list', 'customerCases.get', 'knowledge.list', 'knowledge.get',
    'knowledge.categories.list',
  ],
  [READ_ROUTE_CLASS.ALWAYS_ONLINE]: [
    'config.get', 'assistant.chat', 'metrics.tickets.get', 'legacy.tickets.preview',
    'survey.questions.list', 'survey.responses.get', 'clients.relations.get',
    'customerCases.clientLink.get', 'maintenance.questions.list', 'maintenance.config',
  ],
  [READ_ROUTE_CLASS.MEDIA_STREAM]: [
    'boletas.media.get', 'maintenance.media.get', 'customerCases.media.get', 'knowledge.media.get',
  ],
  [READ_ROUTE_CLASS.GENERATED_ARTIFACT]: [
    'boletas.generatePdf', 'maintenance.report.spreadsheet', 'maintenance.report.slides',
  ],
  [READ_ROUTE_CLASS.SECURITY_SENSITIVE]: [
    'auth.me', 'users.list', 'users.assignment.list', 'roles.list',
    'ticket.signature.public.get', 'maintenance.signature.public.get',
    'ticket.signature.link', 'customerCases.public.get', 'survey.public.get',
  ],
});

test('every sync resource snapshot/detail route is classified DELTA_SYNCED', () => {
  for (const [resource, spec] of Object.entries(syncResourceRegistry)) {
    assert.equal(classifyReadRoute(spec.snapshotRoute), READ_ROUTE_CLASS.DELTA_SYNCED, `${resource} snapshot`);
    assert.equal(classifyReadRoute(spec.detailRoute), READ_ROUTE_CLASS.DELTA_SYNCED, `${resource} detail`);
  }
});

test('important read route families are explicitly classified A-F', () => {
  for (const [classification, routes] of Object.entries(representativeRoutes)) {
    for (const route of routes) {
      assert.equal(classifyReadRoute(route), classification, route);
    }
  }
});

test('action router keeps both explicit and generated CRUD read registrations', () => {
  // CRUD routes such as clients.list are generated from prefix groups at runtime,
  // so their full literal does not necessarily occur in this source file.
  assert.match(routerSource, /const crudRouteGroups = \[/);
  assert.match(routerSource, /\['clients',\['clients','clientes'\]\]/);
  assert.match(routerSource, /\['models',\['catalog\.models','models','modelos'\]\]/);
  assert.match(routerSource, /for\(const \[key,prefixes\] of crudRouteGroups\)/);
  assert.match(routerSource, /add\(\['agenda\.list','agendas\.list'\]/);
  assert.match(routerSource, /add\(\['customerCases\.list','casos\.cliente\.list'\]/);
  assert.match(routerSource, /add\(\['config\.get','app\.config\.get'\]/);
});

test('versioned cache remains empty until a real version contract exists', () => {
  assert.deepEqual(readRouteInventory[READ_ROUTE_CLASS.VERSIONED_CACHE], []);
});

test('media and generated artifacts never fall into collection delta classification', () => {
  for (const route of [...representativeRoutes.MEDIA_STREAM, ...representativeRoutes.GENERATED_ARTIFACT]) {
    assert.notEqual(classifyReadRoute(route), READ_ROUTE_CLASS.DELTA_SYNCED);
  }
});

test('unknown routes are not mislabeled as synchronized', () => {
  assert.equal(classifyReadRoute('future.module.list'), null);
  assert.equal(classifyReadRoute('future.media.get'), READ_ROUTE_CLASS.MEDIA_STREAM);
});
