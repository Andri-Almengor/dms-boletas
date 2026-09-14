import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { formatDate } from '../../utils/tickets';
import Icon from '../common/Icon';

function ticketId(ticket) {
  return String(pick(ticket, ['BoletaUID', 'boletaUid', 'id']));
}

function relationKey(ticket) {
  return String(pick(ticket, ['GrupoVisitaID', 'BoletaPrincipalUID', 'BoletaUID', 'boletaUid', 'id']));
}

function rootId(ticket) {
  return String(pick(ticket, ['BoletaPrincipalUID', 'BoletaUID', 'boletaUid', 'id']));
}

function isStandalone(ticket, relationCounts) {
  const id = ticketId(ticket);
  const group = relationKey(ticket);
  const root = rootId(ticket);
  if (!id || (group && group !== id) || (root && root !== id)) return false;
  return Number(relationCounts.get(group || id) || 0) <= 1;
}

async function loadAllPendingClientTickets(clienteId, sessionToken) {
  const pageSize = 1000;
  let page = 1;
  let total = 0;
  const rows = [];

  do {
    const response = await requestAvailable(
      MODULE_ROUTES.tickets.list,
      {
        status: 'PENDIENTE',
        clienteId,
        page,
        pageSize,
        sortBy: 'BoletaID',
        sortDir: 'desc',
      },
      sessionToken,
    );
    const current = normalizeItems(response);
    rows.push(...current);
    total = Number(response?.total || rows.length);
    if (!current.length) break;
    page += 1;
  } while (rows.length < total);

  return rows;
}

export default function TicketLinkExistingVisitsModal({
  boletaUid,
  clienteId,
  relationIds,
  sessionToken,
  onClose,
  onLinked,
}) {
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    loadAllPendingClientTickets(clienteId, sessionToken)
      .then((result) => {
        if (!active) return;
        setRows(result);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'No fue posible cargar las boletas disponibles.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clienteId, sessionToken]);

  const candidates = useMemo(() => {
    const counts = new Map();
    rows.forEach((ticket) => {
      const key = relationKey(ticket) || ticketId(ticket);
      counts.set(key, Number(counts.get(key) || 0) + 1);
    });
    return rows
      .filter((ticket) => String(pick(ticket, ['ClienteID'])) === String(clienteId))
      .filter((ticket) => !relationIds.has(ticketId(ticket)))
      .filter((ticket) => isStandalone(ticket, counts))
      .sort((left, right) => Number(right.BoletaID || 0) - Number(left.BoletaID || 0));
  }, [clienteId, relationIds, rows]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };

  const save = async () => {
    if (!selectedIds.length || saving) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('Para relacionar boletas debe tener conexión a internet. La relación se valida directamente en el servidor.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await apiRequest('boletas.update', {
        boletaUid,
        linkExistingVisitIds: selectedIds,
      }, sessionToken);
      onLinked?.(result);
    } catch (saveError) {
      setError(saveError.message || 'No fue posible guardar la relación de boletas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ticket-link-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose?.();
    }}>
      <section className="ticket-link-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-link-modal-title">
        <div className="ticket-link-modal__header">
          <div>
            <span className="eyebrow">Seguimiento relacionado</span>
            <h2 id="ticket-link-modal-title">Vincular boletas existentes</h2>
            <p>Seleccione boletas pendientes del mismo cliente para agregarlas a este seguimiento.</p>
          </div>
          <button className="icon-button icon-button--outlined" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>

        {error && <div className="alert alert--warning"><Icon name="warning" /><span>{error}</span></div>}

        <div className="ticket-link-modal__list">
          {loading && <div className="ticket-link-modal__empty"><Icon name="sync" /><span>Cargando boletas pendientes…</span></div>}
          {!loading && !candidates.length && (
            <div className="ticket-link-modal__empty">
              <Icon name="task_alt" />
              <span>No hay otras boletas pendientes e independientes de este cliente para relacionar.</span>
            </div>
          )}
          {!loading && candidates.map((ticket) => {
            const id = ticketId(ticket);
            const checked = selected.has(id);
            return (
              <label className={`ticket-link-option${checked ? ' is-selected' : ''}`} key={id}>
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} disabled={saving} />
                <span className="ticket-link-option__check"><Icon name={checked ? 'check_box' : 'check_box_outline_blank'} /></span>
                <span className="ticket-link-option__content">
                  <strong>Boleta #{pick(ticket, ['BoletaID'], id)}</strong>
                  <span>{formatDate(pick(ticket, ['Fecha']))} · {pick(ticket, ['Titulo'], 'Sin título')}</span>
                  <small>{pick(ticket, ['Ubicacion']) || 'Sin ubicación'}{pick(ticket, ['UbicacionEquipo']) ? ` · ${pick(ticket, ['UbicacionEquipo'])}` : ''}</small>
                </span>
              </label>
            );
          })}
        </div>

        <div className="ticket-link-modal__footer">
          <span>{selectedIds.length ? `${selectedIds.length} seleccionada${selectedIds.length === 1 ? '' : 's'}` : 'Seleccione una o más boletas'}</span>
          <div>
            <button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="button button--primary" type="button" onClick={save} disabled={!selectedIds.length || saving || loading}>
              <Icon name={saving ? 'sync' : 'link'} /> {saving ? 'Guardando…' : 'Guardar relación'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
