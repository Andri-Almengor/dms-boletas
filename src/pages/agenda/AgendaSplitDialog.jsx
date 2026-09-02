import React, { useMemo, useState } from 'react';
import { apiRequest } from '../../api';
import Icon from '../../components/common/Icon';

function clean(value) {
  return String(value ?? '').trim();
}

function personName(user = {}) {
  return clean(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo || 'Usuario');
}

function initials(user = {}) {
  return personName(user).split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'D';
}

function initialRows(item = {}) {
  return (item.asignados || []).map((user) => ({
    key: String(user.UsuarioID),
    user,
    detalle: clean(item.Detalle),
  }));
}

export default function AgendaSplitDialog({ item, sessionToken, onClose, onSaved }) {
  const [rows, setRows] = useState(() => initialRows(item));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canSplit = rows.length >= 2;
  const dateLabel = useMemo(() => clean(item?.Fecha), [item]);

  function updateDetail(key, value) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, detalle: value } : row));
    setMessage('');
  }

  async function save() {
    if (busy || !canSplit) return;
    const invalid = rows.find((row) => !clean(row.detalle));
    if (invalid) {
      setMessage(`Indique el nuevo destino o detalle para ${personName(invalid.user)}.`);
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      // La primera persona conserva el ID original. Para las demás se crean
      // agendas independientes con la misma fecha/horario y referencia al origen.
      // El cliente relacionado se conserva para no perder el vínculo con boletas.
      const first = rows[0];
      const additions = rows.slice(1).map((row) => ({
        agendaOrigenId: item.AgendaID,
        fecha: item.Fecha,
        horaInicio: item.HoraInicio,
        horaFin: item.HoraFin,
        detalle: clean(row.detalle),
        clienteId: clean(item.ClienteID),
        clienteNombre: clean(item.ClienteNombre),
        usuarioIds: [String(row.user.UsuarioID)],
      }));

      let createResult = null;
      if (additions.length) {
        createResult = await apiRequest('agenda.create', { agendas: additions }, sessionToken);
      }

      const updateResult = await apiRequest('agenda.update', {
        agendaId: item.AgendaID,
        fecha: item.Fecha,
        horaInicio: item.HoraInicio,
        horaFin: item.HoraFin,
        detalle: clean(first.detalle),
        clienteId: clean(item.ClienteID),
        clienteNombre: clean(item.ClienteNombre),
        usuarioIds: [String(first.user.UsuarioID)],
      }, sessionToken);

      await onSaved?.({
        message: `La agenda se separó rápidamente en ${rows.length} agendas para el mismo día.`,
        notification: updateResult?.notification?.sent === false
          ? updateResult.notification
          : createResult?.notification,
      });
      onClose?.();
    } catch (error) {
      setMessage(error?.message || 'No se pudo separar la agenda. Revise las agendas creadas antes de reintentar.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="agenda-modal-backdrop agenda-modal-backdrop--editor" role="presentation">
    <section className="agenda-editor agenda-split-dialog" role="dialog" aria-modal="true" aria-label="Separar agenda por persona">
      <header className="agenda-sheet-header">
        <div>
          <span className="eyebrow">Cambio rápido de destino</span>
          <h2>Separar agenda por persona</h2>
          <p>{dateLabel} · {item.HoraInicio} – {item.HoraFin}{item.ClienteNombre ? ` · ${item.ClienteNombre}` : ''}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
      </header>

      <div className="agenda-editor__body">
        <div className="agenda-notice">
          <Icon name="call_split" />
          <span>Cada persona quedará con una agenda independiente para el mismo día. Cambie únicamente el destino o detalle que corresponda y confirme. El cliente relacionado se conserva.</span>
        </div>

        <div className="agenda-split-list">
          {rows.map((row, index) => <article className="agenda-split-row" key={row.key}>
            <div className="agenda-person-chip">
              <b>{initials(row.user)}</b>
              <span><strong>{personName(row.user)}</strong><small>{index === 0 ? 'Conserva la agenda original' : 'Se creará una nueva agenda'}</small></span>
            </div>
            <label>
              <span>Nuevo lugar / detalle *</span>
              <textarea rows="3" maxLength="3000" value={row.detalle} onChange={(event) => updateDetail(row.key, event.target.value)} placeholder="Ej. Asamblea · mantenimiento preventivo" />
            </label>
          </article>)}
        </div>

        {message && <div className="agenda-editor-message"><Icon name="error" /><span>{message}</span></div>}
      </div>

      <footer className="agenda-editor__footer">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="button button--primary" onClick={save} disabled={busy || !canSplit}>
          <Icon name={busy ? 'progress_activity' : 'call_split'} />
          {busy ? 'Separando y notificando...' : `Separar en ${rows.length} agendas`}
        </button>
      </footer>

      {busy && <div className="agenda-processing" role="status"><span><Icon name="progress_activity" /></span><strong>Redistribuyendo las visitas...</strong><small>Se mantienen la fecha, horario y cliente; cada persona recibirá su nueva programación.</small></div>}
    </section>
  </div>;
}
