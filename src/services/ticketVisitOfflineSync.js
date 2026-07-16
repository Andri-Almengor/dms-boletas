import { listQueuedOperations, updateCachedResponses } from './offlineStore';
import { normalizeItems, pick } from './moduleApi';

function cacheRoute(key) {
  return String(key || '').split('|')[1]?.toLowerCase() || '';
}

function ticketId(ticket) {
  return String(pick(ticket, ['BoletaUID', 'boletaUid', 'uid', 'id']));
}

function upsert(items, row) {
  const id = ticketId(row);
  if (!id) return items;
  const index = items.findIndex((item) => ticketId(item) === id);
  if (index < 0) return [...items, row];
  return items.map((item, current) => current === index ? { ...item, ...row } : item);
}

function relatedCreateOperations(operations) {
  return operations.filter((operation) => (
    operation.kind === 'ticketCreate'
    && pick(operation.payload, ['parentTicketId', 'boletaRelacionadaUid', 'BoletaRelacionadaUID'])
  ));
}

async function rebuildOfflineVisitGroups() {
  const operations = relatedCreateOperations(await listQueuedOperations());
  if (!operations.length) return;

  for (const operation of operations) {
    const payload = operation.payload || {};
    const childId = ticketId(payload);
    const parentId = String(pick(payload, ['parentTicketId', 'boletaRelacionadaUid', 'BoletaRelacionadaUID']));
    const rootId = String(pick(payload, ['BoletaPrincipalUID', 'boletaPrincipalUid'], parentId));
    const groupId = String(pick(payload, ['GrupoVisitaID', 'grupoVisitaId'], rootId));
    const child = {
      ...payload,
      BoletaUID: childId,
      boletaUid: childId,
      GrupoVisitaID: groupId,
      BoletaPrincipalUID: rootId,
      NumeroVisita: Number(payload.NumeroVisita || payload.numeroVisita || 2),
      EsVisitaPrincipal: false,
      Estado: String(pick(payload, ['Estado', 'estado'], 'PENDIENTE')).toUpperCase(),
      asignados: (payload.AsignadoA || payload.asignados || []).map((UsuarioID) => ({ UsuarioID })),
      evidenceCount: 0,
      OfflinePendiente: true,
    };

    await updateCachedResponses(
      (entry) => ['boletas.get', 'tickets.get'].includes(cacheRoute(entry.key)),
      (data) => {
        const current = data?.boleta || data;
        const currentId = ticketId(current);
        const existingVisits = data?.visitasRelacionadas || data?.grupoVisitas?.visits || (currentId ? [current] : []);
        const existingRoot = String(data?.grupoVisitas?.rootId || current?.BoletaPrincipalUID || currentId);
        const belongs = [parentId, childId, rootId].includes(currentId)
          || existingRoot === rootId
          || existingVisits.some((visit) => [parentId, childId, rootId].includes(ticketId(visit)));
        if (!belongs) return data;

        let visits = upsert(existingVisits, child);
        if (currentId === parentId && !visits.some((visit) => ticketId(visit) === parentId)) {
          visits = upsert(visits, { ...current, NumeroVisita: 1, EsVisitaPrincipal: true });
        }
        visits = visits.sort((left, right) => Number(left.NumeroVisita || 1) - Number(right.NumeroVisita || 1));
        const group = {
          ...(data?.grupoVisitas || {}),
          id: groupId,
          rootId,
          count: visits.length,
          signed: Boolean(data?.grupoVisitas?.signed || visits.some((visit) => visit.FirmaArchivoID || visit.FirmaURL)),
          visits,
        };
        return {
          ...data,
          boleta: currentId === childId ? { ...current, ...child } : current,
          asignados: currentId === childId ? child.asignados : data?.asignados || [],
          evidencias: data?.evidencias || [],
          grupoVisitas: group,
          visitasRelacionadas: visits,
          offlineQueued: true,
        };
      },
    );
  }
}

let scheduled = 0;
function schedule() {
  window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    rebuildOfflineVisitGroups().catch(() => {});
  }, 120);
}

if (typeof window !== 'undefined') {
  window.addEventListener('dms-offline-queue-change', schedule);
  window.addEventListener('online', schedule);
  schedule();
}

export { rebuildOfflineVisitGroups };
