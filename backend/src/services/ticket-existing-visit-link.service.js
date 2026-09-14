import { badRequest } from '../core/errors.js';
import { nowIso, pick } from '../core/utils.js';
import { readTable, updateRows } from '../infra/sheets.repository.js';
import { audit } from './audit.service.js';
import { assertTicketPayloadAccess } from './ticket-access.service.js';
import {
  ensureVisitGroupForTicket,
  groupSummary,
  synchronizeVisitGroupSignature,
} from './ticket-visit-group.service.js';
import { buildExistingVisitLinkPlan } from './ticket-existing-visit-link.domain.js';

let linkMutationTail = Promise.resolve();

function clean(value) {
  return String(value ?? '').trim();
}

function withLinkMutation(operation) {
  const current = linkMutationTail.catch(() => {}).then(operation);
  linkMutationTail = current.catch(() => {});
  return current;
}

function selectedIds(payload = {}) {
  const value = pick(payload, ['linkExistingVisitIds', 'RelacionarBoletaUIDs'], []);
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

export function isExistingVisitLinkRequest(payload = {}) {
  return selectedIds(payload).length > 0;
}

export async function linkExistingTicketVisits(ctx) {
  const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
  const requestedIds = [...new Set(selectedIds(ctx.payload))];
  if (!ticketId || !requestedIds.length) {
    throw badRequest('Seleccione al menos una boleta para relacionar.');
  }

  await assertTicketPayloadAccess(ctx, { boletaUid: ticketId });
  for (const candidateId of requestedIds) {
    await assertTicketPayloadAccess(ctx, { boletaUid: candidateId });
  }

  return withLinkMutation(async () => {
    const actor = ctx.user?.UsuarioID || 'SISTEMA';
    const targetGroup = await ensureVisitGroupForTicket(ticketId, actor);
    const rows = await readTable('Boletas', { force: true });
    let plan;
    try {
      plan = buildExistingVisitLinkPlan({
        rows,
        targetGroup,
        selectedIds: requestedIds,
        actor,
        timestamp: nowIso(),
      });
    } catch (error) {
      throw badRequest(error?.message || 'No fue posible relacionar las boletas seleccionadas.');
    }

    if (plan.updates.length) await updateRows('Boletas', plan.updates);

    // Esta sincronización reutiliza exactamente la misma firma compartida del
    // flujo "Añadir otra visita". Si el grupo ya estaba firmado, la nueva visita
    // recibe esa firma; si solo una candidata tenía firma, se propaga al grupo.
    await synchronizeVisitGroupSignature(targetGroup.rootId, actor);
    const finalGroup = await ensureVisitGroupForTicket(targetGroup.rootId, actor);

    await audit(ctx, 'VINCULAR_BOLETAS_SEGUIMIENTO', 'Boletas', finalGroup.rootId, targetGroup.root, {
      GrupoVisitaID: finalGroup.id,
      BoletaPrincipalUID: finalGroup.rootId,
      BoletasVinculadas: plan.linkedIds,
      BoletasYaVinculadas: plan.alreadyLinkedIds,
      CantidadVisitas: finalGroup.visits.length,
    });

    return {
      boleta: finalGroup.root,
      grupoVisitas: groupSummary(finalGroup),
      visitasRelacionadas: finalGroup.visits,
      linkedTicketIds: plan.linkedIds,
      alreadyLinkedTicketIds: plan.alreadyLinkedIds,
      message: plan.linkedIds.length
        ? `${plan.linkedIds.length} boleta${plan.linkedIds.length === 1 ? '' : 's'} agregada${plan.linkedIds.length === 1 ? '' : 's'} al seguimiento.`
        : 'Las boletas seleccionadas ya pertenecían a este seguimiento.',
    };
  });
}
