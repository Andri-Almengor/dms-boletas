import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { listQueuedOperations } from '../../services/offlineStore';
import { formatDate, formatTime, normalizeTicketStatus } from '../../utils/tickets';

function visitNumber(visit, index) {
  return Number(pick(visit, ['NumeroVisita', 'visitNumber'], index + 1)) || index + 1;
}

function visitId(visit) {
  return String(pick(visit, ['BoletaUID', 'boletaUid', 'uid', 'id']));
}

function statusLabel(visit) {
  return normalizeTicketStatus(visit) === 'FINALIZADA' ? 'Finalizada' : 'Pendiente';
}

function operationRelatedToGroup(operation, ids) {
  const payload = operation?.payload || {};
  const candidates = [
    operation?.entityId,
    payload.boletaUid,
    payload.BoletaUID,
    payload.parentTicketId,
    payload.boletaRelacionadaUid,
    payload.BoletaRelacionadaUID,
    payload.BoletaPrincipalUID,
    payload.GrupoVisitaID,
  ].map((value) => String(value || '')).filter(Boolean);
  return candidates.some((value) => ids.has(value));
}

export default function TicketVisitGroupPanel({ boletaUid, sessionToken, canCreate, canEdit }) {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState('');
  const [queueState, setQueueState] = useState({ pending: 0, errors: 0, syncing: 0 });

  const visits = useMemo(() => {
    const source = bundle?.visitasRelacionadas || bundle?.grupoVisitas?.visits || [];
    if (source.length) return [...source].sort((left, right) => visitNumber(left, 0) - visitNumber(right, 0));
    return bundle?.boleta ? [bundle.boleta] : [];
  }, [bundle]);

  const relationIds = useMemo(() => {
    const ids = new Set([String(boletaUid || '')]);
    const group = bundle?.grupoVisitas || {};
    [group.id, group.rootId, bundle?.boleta?.GrupoVisitaID, bundle?.boleta?.BoletaPrincipalUID]
      .filter(Boolean)
      .forEach((value) => ids.add(String(value)));
    visits.forEach((visit) => {
      [visitId(visit), visit.GrupoVisitaID, visit.BoletaPrincipalUID]
        .filter(Boolean)
        .forEach((value) => ids.add(String(value)));
    });
    ids.delete('');
    return ids;
  }, [boletaUid, bundle, visits]);

  useEffect(() => {
    let active = true;
    const load = () => {
      requestAvailable(MODULE_ROUTES.tickets.get, { boletaUid, id: boletaUid }, sessionToken)
        .then((result) => {
          if (!active) return;
          setBundle(result);
          setError('');
        })
        .catch((loadError) => { if (active) setError(loadError.message); });
    };
    load();
    window.addEventListener('dms-offline-sync-complete', load);
    return () => {
      active = false;
      window.removeEventListener('dms-offline-sync-complete', load);
    };
  }, [boletaUid, sessionToken]);

  useEffect(() => {
    let active = true;
    const refreshQueue = async () => {
      const operations = await listQueuedOperations().catch(() => []);
      if (!active) return;
      const related = operations.filter((operation) => operationRelatedToGroup(operation, relationIds));
      setQueueState({
        pending: related.length,
        errors: related.filter((item) => String(item.status || '').toUpperCase() === 'ERROR').length,
        syncing: related.filter((item) => String(item.status || '').toUpperCase() === 'SYNCING').length,
      });
    };
    refreshQueue();
    window.addEventListener('dms-offline-queue-change', refreshQueue);
    window.addEventListener('dms-offline-sync-complete', refreshQueue);
    window.addEventListener('dms-offline-sync-error', refreshQueue);
    return () => {
      active = false;
      window.removeEventListener('dms-offline-queue-change', refreshQueue);
      window.removeEventListener('dms-offline-sync-complete', refreshQueue);
      window.removeEventListener('dms-offline-sync-error', refreshQueue);
    };
  }, [relationIds]);

  const groupPending = queueState.pending > 0;

  useEffect(() => {
    document.body.classList.toggle('dms-group-unsynced', groupPending);
    return () => document.body.classList.remove('dms-group-unsynced');
  }, [groupPending]);

  if (!bundle && !error) return null;

  const groupCount = Number(bundle?.grupoVisitas?.count || visits.length || 1);
  const groupSigned = Boolean(bundle?.grupoVisitas?.signed) || visits.some((visit) => pick(visit, ['FirmaArchivoID', 'FirmaURL']));

  return (
    <section className="ticket-visit-group-panel">
      <div className="ticket-visit-group-panel__heading">
        <div>
          <span className="eyebrow">Seguimiento relacionado</span>
          <h2>{groupCount > 1 ? `${groupCount} visitas del mismo trabajo` : 'Visita inicial'}</h2>
          <p>Las visitas mantienen su propia información, evidencias y edición, pero comparten la firma, la encuesta y el envío final.</p>
        </div>
        {canCreate && (
          <Link className="button button--primary" to={`/boletas/${encodeURIComponent(boletaUid)}/nueva-visita`}>
            <Icon name="add_circle" /> Añadir otra visita
          </Link>
        )}
      </div>

      {error && <div className="alert alert--warning"><Icon name="cloud_off" /><span>No se pudo actualizar la relación de visitas: {error}</span></div>}
      {groupPending && (
        <div className="alert alert--warning">
          <Icon name={queueState.errors ? 'sync_problem' : 'sync'} />
          <span>
            {queueState.errors
              ? `${queueState.errors} cambio${queueState.errors === 1 ? '' : 's'} del seguimiento no pudo${queueState.errors === 1 ? '' : 'ieron'} sincronizarse. Use Más → Forzar sincronización para reintentar.`
              : queueState.syncing
                ? 'El seguimiento se está sincronizando. La finalización aparecerá al terminar.'
                : `${queueState.pending} cambio${queueState.pending === 1 ? '' : 's'} pendiente${queueState.pending === 1 ? '' : 's'} de sincronización. La finalización aparecerá al terminar.`}
          </span>
        </div>
      )}
      {groupCount > 1 && <div className="ticket-visit-group-panel__shared"><Icon name={groupSigned ? 'verified' : 'draw'} /><span>{groupSigned ? 'Una firma ya está aplicada a todas las visitas.' : 'El enlace de firma es único: el cliente firma una sola vez para todo el seguimiento.'}</span></div>}

      <div className="ticket-visit-list">
        {visits.map((visit, index) => {
          const id = visitId(visit);
          const current = id === String(boletaUid);
          const status = normalizeTicketStatus(visit);
          const assigned = (visit.asignados || [])
            .map((item) => pick(item, ['NombreCompleto', 'Nombre', 'NombreUsuarioSnapshot', 'Correo']))
            .filter(Boolean)
            .join(', ');
          const visitPending = queueState.pending > 0 && relationIds.has(id);
          return (
            <article className={`ticket-visit-card${current ? ' is-current' : ''}`} key={id || index}>
              <div className="ticket-visit-card__number"><span>Visita</span><strong>{visitNumber(visit, index)}</strong></div>
              <div className="ticket-visit-card__content">
                <div><strong>Boleta #{pick(visit, ['BoletaID'], id)}</strong>{current && <span className="status-chip status-chip--active">Actual</span>}</div>
                <p>{formatDate(pick(visit, ['Fecha']))} · {formatTime(pick(visit, ['HoraInicio'])) || '—'} a {formatTime(pick(visit, ['HoraFinal'])) || '—'} · {pick(visit, ['HorasTotales'], '0.00')} h</p>
                <small>{pick(visit, ['Ubicacion']) || 'Sin ubicación'}{pick(visit, ['UbicacionEquipo']) ? ` · ${pick(visit, ['UbicacionEquipo'])}` : ''}</small>
                {pick(visit, ['Resultado']) && <p className="ticket-visit-card__result">{pick(visit, ['Resultado'])}</p>}
                <div className="ticket-visit-card__meta">
                  <span><Icon name="group" /> {assigned || 'Técnicos asignados'}</span>
                  <span><Icon name="photo_library" /> {Number(pick(visit, ['evidenceCount'], 0))} evidencia(s)</span>
                  <span className={status === 'FINALIZADA' ? 'is-finished' : 'is-pending'}><Icon name={status === 'FINALIZADA' ? 'task_alt' : 'pending_actions'} /> {statusLabel(visit)}</span>
                  {visitPending && <span className="is-pending"><Icon name="cloud_off" /> Sin sincronizar</span>}
                </div>
              </div>
              <div className="ticket-visit-card__actions">
                {!current && <Link className="button button--secondary button--compact" to={`/boletas/${encodeURIComponent(id)}`}><Icon name="visibility" /> Abrir</Link>}
                {canEdit && <Link className="icon-button icon-button--outlined" to={`/boletas/${encodeURIComponent(id)}/editar`} aria-label={`Editar boleta ${pick(visit, ['BoletaID'], id)}`}><Icon name="edit" /></Link>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
