import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const service = source('backend/src/services/ticket-visit-link.service.js');
const handlers = source('backend/src/modules/ticket-visit-link.module.js');
const patch = source('backend/src/services/ticket-visit-link.patch.js');
const panel = source('src/components/tickets/TicketVisitGroupPanel.jsx');
const modal = source('src/components/tickets/TicketVisitLinkControl.jsx');
const delivery = source('backend/src/modules/ticket-delivery.module.js');
const router = source('backend/src/core/action-router.js');

test('vinculación manual reutiliza las rutas y permisos existentes de boletas', () => {
  assert.match(patch, /ticketDeliveryHandlers\.get = async/);
  assert.match(patch, /ticketDeliveryHandlers\.update = async/);
  assert.match(patch, /visitLinkCandidates/);
  assert.match(patch, /visitLinkTargetIds/);
  assert.doesNotMatch(router, /VISIT_LINK|visitLinkCandidates|visitLinkTargetIds/);
  assert.match(router, /else if\(key==='finalize'\) permission='BOLETAS_FINALIZAR'/);
});

test('candidatos se limitan a pendientes del mismo cliente y respetan acceso existente', () => {
  assert.match(handlers, /ticketAccessHandlers\.assertTicketAccess\(ctx, source, 'relacionar'\)/);
  assert.match(handlers, /ticketAccessHandlers\.list/);
  assert.match(handlers, /status: 'PENDIENTE'/);
  assert.match(handlers, /clienteId/);
  assert.match(service, /normalizedStatus\(candidate\.Estado\) !== 'PENDIENTE'/);
  assert.match(service, /clean\(candidate\.ClienteID\) !== clean\(sourceGroup\.root\.ClienteID\)/);
});

test('no fusiona otro seguimiento múltiple ni sobrescribe firmas distintas', () => {
  assert.match(service, /rowsForGroup\(allTickets, candidate\)\.length === 1/);
  assert.match(service, /targetGroup\.length > 1/);
  assert.match(service, /VISIT_LINK_TARGET_ALREADY_GROUPED/);
  assert.match(service, /signatureIds\.size > 1/);
  assert.match(service, /VISIT_LINK_SIGNATURE_CONFLICT/);
});

test('boletas vinculadas entran al GrupoVisitaID existente y reutilizan sincronización de firma', () => {
  assert.match(service, /GrupoVisitaID: sourceGroup\.id/);
  assert.match(service, /BoletaPrincipalUID: sourceGroup\.rootId/);
  assert.match(service, /NumeroVisita: nextVisitNumber\+\+/);
  assert.match(service, /EsVisitaPrincipal: false/);
  assert.match(service, /synchronizeVisitGroupSignature\(sourceGroup\.rootId, actor\)/);
});

test('finalización existente continúa actuando sobre todo el grupo relacionado', () => {
  assert.match(delivery, /ensureVisitGroupForTicket\(requestedTicket\.BoletaUID/);
  assert.match(delivery, /currentGroup\.visits\.every/);
  assert.match(delivery, /persistReportPerVisit\(currentGroup/);
  assert.match(delivery, /Estado: 'FINALIZADA'/);
});

test('interfaz conserva Añadir otra visita y agrega selector checkbox con guardar o cancelar', () => {
  assert.match(panel, /TicketVisitLinkControl/);
  assert.match(panel, /Añadir otra visita/);
  assert.match(modal, /Vincular boletas/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /Guardar relación/);
  assert.match(modal, /Cancelar/);
  assert.match(modal, /visitLinkCandidates: true/);
  assert.match(modal, /visitLinkTargetIds: \[\.\.\.selected\]/);
});
