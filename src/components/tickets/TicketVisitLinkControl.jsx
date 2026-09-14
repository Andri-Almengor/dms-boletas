import React, { useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { formatDate } from '../../utils/tickets';

function ticketId(ticket) {
  return String(pick(ticket, ['BoletaUID', 'boletaUid', 'uid', 'id'], ''));
}

export default function TicketVisitLinkControl({ boletaUid, sessionToken, onLinked }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [clientName, setClientName] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const close = () => {
    if (saving) return;
    setOpen(false);
    setError('');
    setSelected(new Set());
  };

  const loadCandidates = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    setSelected(new Set());
    try {
      const result = await requestAvailable(
        MODULE_ROUTES.tickets.get,
        { boletaUid, id: boletaUid, visitLinkCandidates: true },
        sessionToken,
      );
      setCandidates(Array.isArray(result?.items) ? result.items : []);
      setClientName(String(result?.cliente || ''));
    } catch (loadError) {
      setCandidates([]);
      setError(loadError.message || 'No se pudieron cargar las boletas disponibles.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!selected.size || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await requestAvailable(
        MODULE_ROUTES.tickets.update,
        {
          boletaUid,
          id: boletaUid,
          visitLinkTargetIds: [...selected],
        },
        sessionToken,
      );
      onLinked?.(result);
      setOpen(false);
      setSelected(new Set());
    } catch (saveError) {
      setError(saveError.message || 'No se pudieron relacionar las boletas seleccionadas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" className="button button--secondary" onClick={loadCandidates}>
        <Icon name="link" /> Vincular boletas
      </button>

      {open && (
        <div className="ticket-visit-link-modal" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section className="ticket-visit-link-dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-visit-link-title">
            <header className="ticket-visit-link-dialog__header">
              <div>
                <span className="eyebrow">Seguimiento relacionado</span>
                <h3 id="ticket-visit-link-title">Vincular boletas existentes</h3>
                <p>
                  {clientName
                    ? `Solo se muestran boletas pendientes de ${clientName} a las que tiene acceso.`
                    : 'Solo se muestran boletas pendientes del mismo cliente a las que tiene acceso.'}
                </p>
              </div>
              <button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Cerrar">
                <Icon name="close" />
              </button>
            </header>

            {error && <div className="alert alert--warning"><Icon name="warning" /><span>{error}</span></div>}

            <div className="ticket-visit-link-dialog__body">
              {loading ? (
                <div className="ticket-visit-link-empty"><Icon name="progress_activity" /><span>Cargando boletas pendientes…</span></div>
              ) : candidates.length ? (
                <div className="ticket-visit-link-list">
                  {candidates.map((ticket) => {
                    const id = ticketId(ticket);
                    const checked = selected.has(id);
                    return (
                      <label className={`ticket-visit-link-option${checked ? ' is-selected' : ''}`} key={id}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(id)} disabled={saving} />
                        <span className="ticket-visit-link-option__check" aria-hidden="true"><Icon name={checked ? 'check_box' : 'check_box_outline_blank'} /></span>
                        <span className="ticket-visit-link-option__content">
                          <strong>Boleta #{pick(ticket, ['BoletaID'], id)}</strong>
                          <span>{formatDate(pick(ticket, ['Fecha']))} · {pick(ticket, ['Titulo'], 'Sin título')}</span>
                          <small>{pick(ticket, ['Ubicacion'], 'Sin ubicación')}{pick(ticket, ['UbicacionEquipo']) ? ` · ${pick(ticket, ['UbicacionEquipo'])}` : ''}</small>
                        </span>
                        {ticket.Firmada && <span className="ticket-visit-link-option__signed" title="Esta boleta ya tiene firma"><Icon name="draw" /> Firmada</span>}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="ticket-visit-link-empty">
                  <Icon name="link_off" />
                  <span>No hay otras boletas pendientes e independientes de este cliente disponibles para relacionar.</span>
                </div>
              )}
            </div>

            <footer className="ticket-visit-link-dialog__footer">
              <span>{selected.size ? `${selected.size} seleccionada${selected.size === 1 ? '' : 's'}` : 'Seleccione una o más boletas'}</span>
              <div>
                <button type="button" className="button button--secondary" onClick={close} disabled={saving}>Cancelar</button>
                <button type="button" className="button button--primary" onClick={save} disabled={!selected.size || saving || loading}>
                  <Icon name={saving ? 'progress_activity' : 'link'} /> {saving ? 'Guardando…' : 'Guardar relación'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
