import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
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

export default function TicketVisitGroupPanel({ boletaUid, sessionToken, canCreate, canEdit }) {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState('');

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
    window.addEventListener('dms-offline-queue-change', load);
    return () => {
      active = false;
      window.removeEventListener('dms-offline-sync-complete', load);
      window.removeEventListener('dms-offline-queue-change', load);
    };
  }, [boletaUid, sessionToken]);

  const visits = useMemo(() => {
    const source = bundle?.visitasRelacionadas || bundle?.grupoVisitas?.visits || [];
    if (source.length) return [...source].sort((left, right) => visitNumber(left, 0) - visitNumber(right, 0));
    return bundle?.boleta ? [bundle.boleta] : [];
  }, [bundle]);

  const groupPending = visits.some((visit) => Boolean(pick(visit, ['OfflinePendiente', 'offlinePending'], false)) || visitId(visit).startsWith('boleta-'));

  useEffect(() => {
    document.body.classList.toggle('dms-entity-unsynced', groupPending);
    return () => document.body.classList.remove('dms-entity-unsynced');
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
          <p>Las visitas mantienen su propia información, evidencias y edición, pero comparten la firma, la encuesta y el reporte final.</p>
        </div>
        {canCreate && (
          <Link className="button button--primary" to={`/boletas/${encodeURIComponent(boletaUid)}/nueva-visita`}>
            <Icon name="add_circle" /> Añadir otra visita
          </Link>
        )}
      </div>

      {error && <div className="alert alert--warning"><Icon name="cloud_off" /><span>No se pudo actualizar la relación de visitas: {error}</span></div>}
      {groupPending && <div className="alert alert--warning"><Icon name="sync_problem" /><span>Hay visitas o evidencias pendientes de sincronización. La finalización aparecerá cuando todo el seguimiento esté sincronizado.</span></div>}
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
                  {pick(visit, ['OfflinePendiente']) && <span className="is-pending"><Icon name="cloud_off" /> Sin sincronizar</span>}
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
