import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import '../../styles/ticket-history.css';

const FIELD_LABELS = Object.freeze({
  Titulo: 'Título', Estado: 'Estado', Fecha: 'Fecha', HoraInicio: 'Hora inicio',
  HoraFinal: 'Hora final', HorasTotales: 'Horas totales', Cliente: 'Cliente',
  Ubicacion: 'Ubicación', UbicacionEquipo: 'Ubicación del equipo',
  Supervisor: 'Supervisor', CorreoCliente: 'Correo cliente',
  CorreoSupervisor: 'Correo supervisor', Categoria: 'Categoría',
  TipoFalla: 'Tipo de falla', TipoDispositivo: 'Tipo de dispositivo',
  Fabricante: 'Fabricante', Modelo: 'Modelo', Serie: 'Serie',
  DireccionMAC: 'Dirección MAC', RazonVisita: 'Razón de visita',
  Descripcion: 'Nombre / descripción del dispositivo',
  PruebasRealizadas: 'Pruebas realizadas', Resultado: 'Resultado',
  Recomendaciones: 'Recomendaciones',
  EnviarCorreoCliente: 'Enviar copia al cliente', CorreosCC: 'Correos CC',
  AsignadoA: 'Técnicos asignados',
});

function fieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Ninguno';
  if (value === undefined || value === null || value === '') return 'Sin dato';
  return String(value);
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return String(value || 'Sin fecha');
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica',
  }).format(date);
}

function TicketSnapshot({ data }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <p>No se conservó una versión completa en este registro histórico.</p>;
  return (
    <dl className="ticket-history-snapshot">
      {entries.map(([field, value]) => (
        <div key={field}>
          <dt>{fieldLabel(field)}</dt>
          <dd>{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryEntry({ entry }) {
  const before = entry.antes || {};
  const after = entry.despues || {};
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  return (
    <article className="ticket-history-entry">
      <div className="ticket-history-entry__heading">
        <div>
          <strong>{entry.usuario || 'Usuario desconocido'}</strong>
          <span>{entry.accion === 'AUTOGUARDAR_BOLETA' ? 'Autoguardado' : 'Edición de boleta'}</span>
        </div>
        <time dateTime={entry.fecha}>{formatDate(entry.fecha)}</time>
      </div>
      {changed.length ? (
        <div className="ticket-history-changes">
          {changed.map((field) => (
            <div className="ticket-history-change" key={field}>
              <strong>{fieldLabel(field)}</strong>
              <div className="ticket-history-compare">
                <div><span>Antes</span><p>{formatValue(before[field])}</p></div>
                <div><span>Después</span><p>{formatValue(after[field])}</p></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="ticket-history-muted">Esta edición histórica no conserva diferencias de campos visibles; pudo modificar asignaciones que antes no se registraban por separado.</p>
      )}
      <details className="ticket-history-revision">
        <summary>Ver cómo estaba toda la boleta antes de la edición</summary>
        <TicketSnapshot data={before} />
      </details>
      <details className="ticket-history-revision">
        <summary>Ver la boleta después de la edición</summary>
        <TicketSnapshot data={after} />
      </details>
    </article>
  );
}

// Rendered only for users with USUARIOS_GESTIONAR. The backend independently
// checks the same permission on every history request.
export default function TicketHistoryPanel({ boletaUid, sessionToken }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setOpen(false);
    setItems([]);
    setPage(0);
    setHasMore(false);
    setLoaded(false);
    setError('');
    setBusy(false);
    return () => { requestSequence.current += 1; };
  }, [boletaUid, sessionToken]);

  async function loadHistory(nextPage = 1) {
    if (busy || !sessionToken || !boletaUid) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError('');
    try {
      const result = await requestAvailable(
        MODULE_ROUTES.tickets.history, { boletaUid, page: nextPage, pageSize: 20 }, sessionToken,
      );
      if (sequence !== requestSequence.current) return;
      const rows = Array.isArray(result?.items) ? result.items : [];
      setItems((existing) => nextPage === 1 ? rows : [
        ...existing, ...rows.filter((row) => !existing.some((old) => old.id === row.id)),
      ]);
      setPage(nextPage);
      setHasMore(Boolean(result?.hasMore));
      setLoaded(true);
    } catch (failure) {
      if (sequence === requestSequence.current) {
        setError(failure?.message || 'No se pudo cargar el historial de esta boleta.');
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }

  function toggleHistory() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !busy) void loadHistory();
  }

  return (
    <section className="ticket-history section-block" aria-label="Historial de ediciones de la boleta">
      <button type="button" className="ticket-history-toggle" aria-expanded={open} onClick={toggleHistory}>
        <Icon name="history" />
        <span><strong>Historial de ediciones</strong><small>Consultar quién cambió la boleta y comparar versiones</small></span>
        <Icon name={open ? 'expand_less' : 'expand_more'} />
      </button>
      {open && (
        <div className="ticket-history-body">
          <div className="ticket-history-toolbar">
            <p>Registro de consulta exclusiva para Administrador y Supervisor.</p>
            <button type="button" className="button button--secondary button--compact"
              onClick={() => loadHistory(1)} disabled={busy}>
              <Icon name="refresh" /> Actualizar
            </button>
          </div>
          {error && <div className="alert alert--error" role="alert">{error}</div>}
          {busy && !items.length && <p role="status" className="ticket-history-muted">Consultando historial...</p>}
          {loaded && !items.length && !busy && <p className="ticket-history-muted">Esta boleta todavía no tiene ediciones registradas en la auditoría.</p>}
          <div className="ticket-history-list">{items.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}</div>
          {hasMore && <button className="button button--secondary ticket-history-more" type="button"
            disabled={busy} onClick={() => loadHistory(page + 1)}>
            <Icon name="expand_more" /> {busy ? 'Cargando...' : 'Ver más cambios'}
          </button>}
          <p className="ticket-history-footnote">Las versiones muestran los datos conservados por la auditoría. Los autoguardados anteriores a la activación de esta función y los cambios no registrados históricamente no se pueden reconstruir.</p>
        </div>
      )}
    </section>
  );
}
