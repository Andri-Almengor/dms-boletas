import {
  cacheResponse,
  readCachedResponse,
  responseCacheKey,
} from './offlineStore';
import { MODULE_ROUTES, pick } from './moduleApi';

function idOf(ticket) {
  return String(pick(ticket, ['BoletaUID', 'boletaUid', 'uid', 'id']));
}

function normalizedVisits(bundle) {
  const source = bundle?.visitasRelacionadas || bundle?.grupoVisitas?.visits || [];
  if (source.length) return source;
  return bundle?.boleta ? [bundle.boleta] : [];
}

function upsertVisit(visits, visit) {
  const id = idOf(visit);
  const existing = visits.findIndex((item) => idOf(item) === id);
  if (existing < 0) return [...visits, visit];
  return visits.map((item, index) => index === existing ? { ...item, ...visit } : item);
}

function sorted(visits) {
  return [...visits].sort((left, right) => Number(left.NumeroVisita || 1) - Number(right.NumeroVisita || 1));
}

async function detailKeys(ticketId, sessionToken) {
  return [
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: ticketId }, sessionToken),
    responseCacheKey(MODULE_ROUTES.tickets.get, { boletaUid: ticketId, id: ticketId }, sessionToken),
  ];
}

export async function linkRelatedVisitInOfflineCache({
  parentBundle,
  childBundle,
  childPayload,
  sessionToken,
}) {
  const parent = parentBundle?.boleta || {};
  const child = childBundle?.boleta || childBundle || childPayload;
  const parentId = idOf(parent);
  const childId = idOf(child);
  if (!parentId || !childId) return;

  const previousVisits = normalizedVisits(parentBundle);
  const childView = {
    ...childPayload,
    ...child,
    BoletaUID: childId,
    boletaUid: childId,
    NumeroVisita: Number(child.NumeroVisita || childPayload.NumeroVisita || previousVisits.length + 1),
    GrupoVisitaID: child.GrupoVisitaID || childPayload.GrupoVisitaID || parent.GrupoVisitaID || parentId,
    BoletaPrincipalUID: child.BoletaPrincipalUID || childPayload.BoletaPrincipalUID || parent.BoletaPrincipalUID || parentId,
    EsVisitaPrincipal: false,
    asignados: childBundle?.asignados || (childPayload.AsignadoA || []).map((UsuarioID) => ({ UsuarioID })),
    evidenceCount: Number(child.evidenceCount || 0),
    OfflinePendiente: Boolean(child.OfflinePendiente || childId.startsWith('boleta-')),
  };
  const visits = sorted(upsertVisit(previousVisits, childView));
  const rootId = String(parentBundle?.grupoVisitas?.rootId || parent.BoletaPrincipalUID || parentId);
  const groupId = String(parentBundle?.grupoVisitas?.id || parent.GrupoVisitaID || rootId);
  const signed = Boolean(parentBundle?.grupoVisitas?.signed || parent.FirmaArchivoID || parent.FirmaURL);
  const group = {
    ...(parentBundle?.grupoVisitas || {}),
    id: groupId,
    rootId,
    count: visits.length,
    signed,
    visits,
  };

  for (const visit of visits) {
    const ticketId = idOf(visit);
    const keys = await detailKeys(ticketId, sessionToken);
    for (const key of keys) {
      const current = await readCachedResponse(key, 0);
      const original = current || (ticketId === parentId ? parentBundle : ticketId === childId ? childBundle : null) || {};
      const currentTicket = original.boleta || visit;
      await cacheResponse(key, {
        ...original,
        boleta: { ...currentTicket, ...visit },
        asignados: original.asignados || visit.asignados || [],
        evidencias: original.evidencias || [],
        grupoVisitas: group,
        visitasRelacionadas: visits,
        offlineQueued: visits.some((item) => item.OfflinePendiente),
      });
    }
  }
}
