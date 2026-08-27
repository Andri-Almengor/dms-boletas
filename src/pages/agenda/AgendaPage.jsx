import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import {
  agendaRequiresTicket,
  calendarDays,
  calendarMonthRange,
  costaRicaDateKey,
  groupAgendasByDate,
  monthKey,
  monthLabel,
  normalizeAgendaText,
  shiftMonth,
  statusMeta,
  tomorrowCostaRicaDate,
} from '../../features/agenda/agendaDomain';
import AgendaSplitDialog from './AgendaSplitDialog';
import '../../styles/agenda.css';
import '../../styles/agenda-split.css';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const EMPTY_DRAFT = Object.freeze({ fecha: '', horaInicio: '07:00', horaFin: '17:00', detalle: '', usuarioIds: [] });

function personName(user = {}) {
  return String(user.NombreCompleto || user.Nombre || user.NombreUsuario || user.Correo || 'Usuario').trim();
}

function shortPersonName(user = {}) {
  const parts = personName(user).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[1]}` : parts[0] || 'Usuario';
}

function formatDateLong(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function dayNumber(dateKey) {
  return Number(String(dateKey || '').slice(8, 10)) || '';
}

function initials(user = {}) {
  return personName(user).split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'D';
}

function AgendaStatus({ item, compact = false }) {
  const meta = statusMeta(item?.status);
  return <span className={`agenda-status agenda-status--${meta.tone}${compact ? ' agenda-status--compact' : ''}`}>
    <Icon name={meta.icon} />
    <span>{meta.label}</span>
  </span>;
}

function AgendaCard({ item, onOpen, compact = false }) {
  return <button type="button" className={`agenda-event-card${compact ? ' agenda-event-card--compact' : ''}`} onClick={() => onOpen(item)}>
    <span className="agenda-event-card__time">{item.HoraInicio || '07:00'}</span>
    <strong>{item.Detalle}</strong>
    <span className="agenda-event-card__people">{item.asignados?.map(shortPersonName).join(', ') || 'Sin asignación'}</span>
    <AgendaStatus item={item} compact />
  </button>;
}

function AgendaDetail({ item, isAdmin, onClose, onEdit, onSplit }) {
  if (!item) return null;
  const meta = statusMeta(item.status);
  const canSplit = isAdmin && item.Estado !== 'CANCELADA' && (item.asignados || []).length > 1;

  return <div className="agenda-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="agenda-detail-sheet" role="dialog" aria-modal="true" aria-label="Detalle de agenda">
      <header className="agenda-sheet-header">
        <div><span className="eyebrow">Detalle de visita</span><h2>{formatDateLong(item.Fecha)}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </header>

      <div className="agenda-detail-sheet__status"><AgendaStatus item={item} /></div>
      <div className="agenda-detail-sheet__time"><Icon name="schedule" /><strong>{item.HoraInicio} – {item.HoraFin}</strong></div>

      <section className="agenda-detail-block">
        <span>Detalle</span>
        <p>{item.Detalle}</p>
      </section>

      <section className="agenda-detail-block">
        <span>Personas asignadas</span>
        <div className="agenda-person-list">
          {(item.asignados || []).map((user) => <div key={user.UsuarioID} className="agenda-person-chip">
            <b>{initials(user)}</b>
            <span><strong>{personName(user)}</strong>{user.Correo && <small>{user.Correo}</small>}</span>
          </div>)}
        </div>
      </section>

      <section className={`agenda-ticket-box agenda-ticket-box--${meta.tone}`}>
        <Icon name={meta.icon} />
        <div>
          <strong>{meta.label}</strong>
          {item.boleta
            ? <span>{item.boleta.BoletaNumero ? `Boleta #${item.boleta.BoletaNumero}` : 'Boleta relacionada'}{item.boleta.Titulo ? ` · ${item.boleta.Titulo}` : ''}</span>
            : <span>{item.RequiereBoleta ? 'Esta visita requiere una boleta.' : 'Esta agenda está excluida del control de boleta.'}</span>}
        </div>
        {item.boleta?.BoletaUID && <Link className="button button--secondary button--compact" to={`/boletas/${encodeURIComponent(item.boleta.BoletaUID)}`}><Icon name="open_in_new" /> Ver boleta</Link>}
      </section>

      {isAdmin && <div className="agenda-sheet-actions">
        {canSplit && <button type="button" className="button button--secondary" onClick={() => onSplit(item)}><Icon name="call_split" /> Separar por persona</button>}
        <button type="button" className="button button--primary" onClick={() => onEdit(item)}><Icon name="edit_calendar" /> Modificar agenda</button>
      </div>}
    </section>
  </div>;
}

function UserSelector({ users, selected, onChange }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const query = normalizeAgendaText(search);
    return query ? users.filter((user) => normalizeAgendaText(`${personName(user)} ${user.Correo || ''}`).includes(query)) : users;
  }, [search, users]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = users.length > 0 && users.every((user) => selectedSet.has(String(user.UsuarioID)));

  function toggle(userId) {
    const id = String(userId);
    onChange(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  return <div className="agenda-user-selector">
    <div className="agenda-user-selector__tools">
      <label className="agenda-search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar persona" /></label>
      <button type="button" className="button button--secondary button--compact" onClick={() => onChange(allSelected ? [] : users.map((user) => String(user.UsuarioID)))}>{allSelected ? 'Quitar todos' : 'Seleccionar todos'}</button>
    </div>
    <div className="agenda-user-grid">
      {filtered.map((user) => {
        const checked = selectedSet.has(String(user.UsuarioID));
        return <button key={user.UsuarioID} type="button" className={`agenda-user-option${checked ? ' is-selected' : ''}`} onClick={() => toggle(user.UsuarioID)} aria-pressed={checked}>
          <span className="agenda-user-option__check"><Icon name={checked ? 'check_circle' : 'radio_button_unchecked'} /></span>
          <b>{initials(user)}</b>
          <span><strong>{personName(user)}</strong>{user.Correo && <small>{user.Correo}</small>}</span>
        </button>;
      })}
    </div>
    {!filtered.length && <div className="agenda-empty-inline">No hay usuarios que coincidan con la búsqueda.</div>}
  </div>;
}

function AgendaEditor({ users, editItem, onClose, onSaved, sessionToken }) {
  const editing = Boolean(editItem?.AgendaID);
  const [draft, setDraft] = useState(() => editing ? {
    fecha: editItem.Fecha,
    horaInicio: editItem.HoraInicio || '07:00',
    horaFin: editItem.HoraFin || '17:00',
    detalle: editItem.Detalle || '',
    usuarioIds: (editItem.asignados || []).map((user) => String(user.UsuarioID)),
  } : { ...EMPTY_DRAFT, fecha: tomorrowCostaRicaDate() });
  const [queue, setQueue] = useState([]);
  const [queueEditIndex, setQueueEditIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const requiresTicket = agendaRequiresTicket(draft.detalle);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setMessage('');
  }

  function validateDraft() {
    if (!draft.fecha) return 'Seleccione una fecha.';
    if (!draft.detalle.trim()) return 'Escriba el detalle de la agenda.';
    if (!draft.usuarioIds.length) return 'Seleccione al menos una persona.';
    if (!draft.horaInicio || !draft.horaFin || draft.horaInicio >= draft.horaFin) return 'Revise el horario de inicio y fin.';
    return '';
  }

  function resetDraft() {
    setDraft({ ...EMPTY_DRAFT, fecha: tomorrowCostaRicaDate() });
    setQueueEditIndex(-1);
  }

  function stageAgenda() {
    const error = validateDraft();
    if (error) { setMessage(error); return; }
    const row = { ...draft, detalle: draft.detalle.trim(), usuarioIds: [...draft.usuarioIds] };
    setQueue((current) => queueEditIndex >= 0
      ? current.map((item, index) => index === queueEditIndex ? row : item)
      : [...current, row]);
    resetDraft();
  }

  function editQueued(index) {
    const item = queue[index];
    setDraft({ ...item, usuarioIds: [...item.usuarioIds] });
    setQueueEditIndex(index);
  }

  async function save() {
    if (busy) return;
    if (editing) {
      const error = validateDraft();
      if (error) { setMessage(error); return; }
    } else if (!queue.length) {
      const error = validateDraft();
      setMessage(error || 'Agregue esta agenda a la lista antes de enviarla.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const response = editing
        ? await apiRequest('agenda.update', {
          agendaId: editItem.AgendaID,
          fecha: draft.fecha,
          horaInicio: draft.horaInicio,
          horaFin: draft.horaFin,
          detalle: draft.detalle.trim(),
          usuarioIds: draft.usuarioIds,
        }, sessionToken)
        : await apiRequest('agenda.create', { agendas: queue }, sessionToken);
      await onSaved(response);
      onClose();
    } catch (error) {
      setMessage(error?.message || 'No se pudo guardar la agenda.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="agenda-modal-backdrop agenda-modal-backdrop--editor" role="presentation">
    <section className="agenda-editor" role="dialog" aria-modal="true" aria-label={editing ? 'Modificar agenda' : 'Crear agendas'}>
      <header className="agenda-sheet-header">
        <div><span className="eyebrow">{editing ? 'Actualizar programación' : 'Programación rápida'}</span><h2>{editing ? 'Modificar agenda' : 'Crear agendas'}</h2><p>{editing ? 'Los cambios se notificarán a las personas afectadas.' : 'Prepare una o varias visitas y envíelas juntas cuando estén listas.'}</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
      </header>

      <div className="agenda-editor__body">
        <div className="agenda-form-grid">
          <label><span>Fecha *</span><input type="date" value={draft.fecha} onChange={(event) => updateField('fecha', event.target.value)} /></label>
          <label><span>Hora de inicio</span><input type="time" value={draft.horaInicio} onChange={(event) => updateField('horaInicio', event.target.value)} /></label>
          <label><span>Hora de fin</span><input type="time" value={draft.horaFin} onChange={(event) => updateField('horaFin', event.target.value)} /></label>
          <label className="agenda-form-grid__detail"><span>Detalle de la visita *</span><textarea value={draft.detalle} onChange={(event) => updateField('detalle', event.target.value)} maxLength="3000" rows="4" placeholder="Ej. Asamblea · mantenimiento preventivo de cámaras" /></label>
        </div>

        {draft.detalle.trim() && <div className={`agenda-rule-note${requiresTicket ? '' : ' is-exempt'}`}><Icon name={requiresTicket ? 'assignment' : 'remove_done'} /><span>{requiresTicket ? 'Esta visita requerirá una boleta.' : 'Por el detalle indicado (Oficina/RN), esta agenda no requerirá boleta ni recordatorio.'}</span></div>}

        <section className="agenda-editor-section">
          <div className="agenda-editor-section__title"><div><span className="eyebrow">Asignación</span><h3>Personas que asistirán</h3></div><span>{draft.usuarioIds.length} seleccionada{draft.usuarioIds.length === 1 ? '' : 's'}</span></div>
          <UserSelector users={users} selected={draft.usuarioIds} onChange={(value) => updateField('usuarioIds', value)} />
        </section>

        {!editing && <section className="agenda-editor-section agenda-queue-section">
          <div className="agenda-editor-section__title"><div><span className="eyebrow">Antes de enviar</span><h3>Agendas preparadas</h3></div><span>{queue.length}</span></div>
          <div className="agenda-notice"><Icon name="groups" /><span>Puede agregar varias agendas con la misma fecha. Esto permite programar distintos grupos o personas para diferentes lugares durante el mismo día.</span></div>
          <button type="button" className="button button--secondary agenda-stage-button" onClick={stageAgenda}><Icon name={queueEditIndex >= 0 ? 'save' : 'playlist_add'} />{queueEditIndex >= 0 ? 'Guardar cambios en la lista' : 'Agregar a la lista'}</button>
          {queue.length > 0 ? <div className="agenda-queue-list">{queue.map((item, index) => <article key={`${item.fecha}-${index}`} className="agenda-queue-card">
            <div><strong>{formatDateLong(item.fecha)}</strong><span>{item.horaInicio} – {item.horaFin}</span><p>{item.detalle}</p><small>{item.usuarioIds.map((id) => shortPersonName(users.find((user) => String(user.UsuarioID) === id) || {})).join(', ')}</small></div>
            <div><button type="button" className="icon-button" onClick={() => editQueued(index)} aria-label="Editar"><Icon name="edit" /></button><button type="button" className="icon-button icon-button--danger" onClick={() => setQueue((current) => current.filter((_, currentIndex) => currentIndex !== index))} aria-label="Quitar"><Icon name="delete" /></button></div>
          </article>)}</div> : <div className="agenda-empty-inline">Todavía no hay agendas en la lista de envío.</div>}
        </section>}

        {message && <div className="agenda-editor-message"><Icon name="error" /><span>{message}</span></div>}
      </div>

      <footer className="agenda-editor__footer">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="button button--primary" onClick={save} disabled={busy || (!editing && !queue.length)}><Icon name={busy ? 'progress_activity' : editing ? 'save' : 'send'} />{busy ? (editing ? 'Actualizando...' : 'Creando y enviando...') : editing ? 'Guardar cambios' : `Crear y enviar (${queue.length})`}</button>
      </footer>

      {busy && <div className="agenda-processing" role="status"><span><Icon name="progress_activity" /></span><strong>{editing ? 'Actualizando agenda y notificando...' : 'Creando agendas y enviando correos...'}</strong><small>No cierre esta pantalla mientras se completa el envío.</small></div>}
    </section>
  </div>;
}

export default function AgendaPage() {
  const { sessionToken, hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const requestedAgendaId = searchParams.get('agendaId') || '';
  const requestedMonth = searchParams.get('month') || '';
  const [month, setMonth] = useState(() => /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : monthKey());
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);
  const [splitItem, setSplitItem] = useState(null);
  const today = costaRicaDateKey();
  const days = useMemo(() => calendarDays(month), [month]);
  const range = useMemo(() => calendarMonthRange(month), [month]);

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError('');
    try {
      const requests = [apiRequest('agenda.list', { from: range.from, to: range.to }, sessionToken)];
      if (isAdmin) requests.push(apiRequest('users.assignment.list', { pageSize: 1000 }, sessionToken));
      const [agendaData, userData] = await Promise.all(requests);
      setItems(Array.isArray(agendaData?.items) ? agendaData.items : []);
      if (isAdmin) setUsers(Array.isArray(userData?.items) ? userData.items : []);
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo cargar la agenda.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, range.from, range.to, sessionToken]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!requestedAgendaId) return;
    const item = items.find((row) => String(row.AgendaID) === requestedAgendaId);
    if (item) setSelected(item);
  }, [items, requestedAgendaId]);

  useEffect(() => {
    if (!requestedAgendaId || selected || loading) return;
    apiRequest('agenda.get', { agendaId: requestedAgendaId }, sessionToken)
      .then((data) => {
        const item = data?.item;
        if (!item) return;
        const itemMonth = String(item.Fecha || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(itemMonth) && itemMonth !== month) setMonth(itemMonth);
        setSelected(item);
      })
      .catch(() => {});
  }, [loading, month, requestedAgendaId, selected, sessionToken]);

  const filtered = useMemo(() => {
    const query = normalizeAgendaText(search);
    if (!query) return items;
    return items.filter((item) => normalizeAgendaText(`${item.Detalle} ${(item.asignados || []).map(personName).join(' ')}`).includes(query));
  }, [items, search]);
  const grouped = useMemo(() => groupAgendasByDate(filtered), [filtered]);
  const visibleMobileDates = useMemo(() => [...grouped.keys()].sort(), [grouped]);

  function openAgenda(item) {
    setSelected(item);
    const next = new URLSearchParams(searchParams);
    next.set('agendaId', item.AgendaID);
    next.set('month', String(item.Fecha || '').slice(0, 7));
    setSearchParams(next, { replace: true });
  }

  function closeAgenda() {
    setSelected(null);
    const next = new URLSearchParams(searchParams);
    next.delete('agendaId');
    setSearchParams(next, { replace: true });
  }

  async function saved(response) {
    const warning = response?.notification?.sent === false && response?.notification?.error
      ? `La agenda se guardó, pero el correo reportó: ${response.notification.error}`
      : response?.message || 'Agenda guardada correctamente.';
    setNotice(warning);
    await load();
  }

  function goToday() {
    setMonth(monthKey(today));
  }

  return <div className="page agenda-page">
    <header className="agenda-hero">
      <div><span className="eyebrow">Programación operativa</span><h1>Agenda DMS</h1><p>{isAdmin ? 'Programe visitas, asigne una o varias personas y controle si cada visita generó su boleta.' : 'Consulte sus visitas programadas y el estado de la boleta asociada a cada una.'}</p></div>
      {isAdmin && <button type="button" className="button button--primary" onClick={() => setEditor({ mode: 'create' })}><Icon name="add_task" /> Nueva agenda</button>}
    </header>

    {notice && <div className="agenda-notice"><Icon name="info" /><span>{notice}</span><button type="button" className="icon-button" onClick={() => setNotice('')} aria-label="Cerrar"><Icon name="close" /></button></div>}
    {error && <div className="state-card state-card--error"><Icon name="error" /><span>{error}</span><button type="button" className="button button--secondary button--compact" onClick={load}>Reintentar</button></div>}

    <section className="agenda-toolbar">
      <div className="agenda-month-navigation">
        <button type="button" className="icon-button" onClick={() => setMonth((current) => shiftMonth(current, -1))} aria-label="Mes anterior"><Icon name="chevron_left" /></button>
        <h2>{monthLabel(month)}</h2>
        <button type="button" className="icon-button" onClick={() => setMonth((current) => shiftMonth(current, 1))} aria-label="Mes siguiente"><Icon name="chevron_right" /></button>
        <button type="button" className="button button--secondary button--compact" onClick={goToday}>Hoy</button>
      </div>
      <label className="agenda-search-field agenda-search-field--main"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por detalle o persona" /></label>
    </section>

    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando agenda...</span></div> : <>
      <section className="agenda-calendar" aria-label={`Calendario de ${monthLabel(month)}`}>
        <div className="agenda-calendar__weekdays">{WEEKDAYS.map((day) => <strong key={day}>{day}</strong>)}</div>
        <div className="agenda-calendar__grid">{days.map((date) => {
          const rows = grouped.get(date) || [];
          const outside = date.slice(0, 7) !== month;
          return <article key={date} className={`agenda-calendar-day${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}`}>
            <header><span>{dayNumber(date)}</span>{date === today && <em>Hoy</em>}</header>
            <div>{rows.slice(0, 4).map((item) => <AgendaCard key={item.AgendaID} item={item} onOpen={openAgenda} compact />)}{rows.length > 4 && <button type="button" className="agenda-more-events" onClick={() => openAgenda(rows[4])}>+{rows.length - 4} más</button>}</div>
          </article>;
        })}</div>
      </section>

      <section className="agenda-mobile-list" aria-label="Agenda por días">
        {visibleMobileDates.length ? visibleMobileDates.map((date) => <article key={date} className="agenda-mobile-day">
          <header><div><strong>{formatDateLong(date)}</strong>{date === today && <span>Hoy</span>}</div><b>{grouped.get(date).length}</b></header>
          <div>{grouped.get(date).map((item) => <AgendaCard key={item.AgendaID} item={item} onOpen={openAgenda} />)}</div>
        </article>) : <div className="agenda-empty-state"><Icon name="event_available" /><strong>No hay agendas en este período</strong><span>{search ? 'Cambie la búsqueda para ver otros resultados.' : 'Las visitas programadas aparecerán aquí.'}</span></div>}
      </section>
    </>}

    <AgendaDetail
      item={selected}
      isAdmin={isAdmin}
      onClose={closeAgenda}
      onEdit={(item) => { closeAgenda(); setEditor({ mode: 'edit', item }); }}
      onSplit={(item) => { closeAgenda(); setSplitItem(item); }}
    />
    {editor && <AgendaEditor users={users} editItem={editor.mode === 'edit' ? editor.item : null} onClose={() => setEditor(null)} onSaved={saved} sessionToken={sessionToken} />}
    {splitItem && <AgendaSplitDialog item={splitItem} sessionToken={sessionToken} onClose={() => setSplitItem(null)} onSaved={saved} />}
  </div>;
}
