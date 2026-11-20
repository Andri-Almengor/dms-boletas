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

function HistoryEntry({ entry, index }) {
  const before = entry.antes || {};
  const after = entry.despues || {};
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  return (
    <details className="ticket-history-entry" open={index === 0}>
      <summary className="ticket-history-entry__heading">
        <span className="ticket-history-entry__marker"><Icon name={entry.accion === 'AUTOGUARDAR_BOLETA' ? 'save' : 'edit_note'} /></span>
        <span className="ticket-history-entry__identity">
          <strong>{entry.usuario || 'Usuario desconocido'}</strong>
          <span>{entry.accion === 'AUTOGUARDAR_BOLETA' ? 'Autoguardado' : 'Edición de boleta'} · {formatDate(entry.fecha)}</span>
        </span>
        <span className="ticket-history-entry__count">
          {changed.length} {changed.length === 1 ? 'campo modificado' : 'campos modificados'}
          <Icon name="expand_more" />
        </span>
      </summary>
      <div className="ticket-history-entry__content">
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
      </div>
    </details>
  );
}

// Embedded in the independent management-only route. The backend revalidates
// USUARIOS_GESTIONAR for every history request.
export default function TicketHistoryPanel({ boletaUid, sessionToken }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  async function loadHistory(nextPage = 1) {
    if (!sessionToken || !boletaUid) return;
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

  // Fetch automatically when the dedicated window opens, with no extra click.
  useEffect(() => {
    requestSequence.current += 1;
    setItems([]);
    setPage(0);
    setHasMore(false);
    setLoaded(false);
    setError('');
    void loadHistory(1);
    return () => { requestSequence.current += 1; };
  }, [boletaUid, sessionToken]);

  return (
    <section className="ticket-history section-block" aria-label="Historial de ediciones de la boleta">
      <div className="ticket-history-body">
        <div className="ticket-history-toolbar">
          <div>
            <span className="ticket-history-kicker"><Icon name="manage_search" /> Registro de actividad</span>
            <h2>Cambios registrados</h2>
            <p>{loaded ? `${items.length} ${items.length === 1 ? 'edición cargada' : 'ediciones cargadas'}${hasMore ? ' · Hay más cambios por consultar' : ''}`
              : 'Versiones anteriores y posteriores disponibles para su consulta.'}</p>
          </div>
          <button type="button" className="button button--secondary button--compact"
            onClick={() => loadHistory(1)} disabled={busy}>
            <Icon name="refresh" /> {busy ? 'Consultando…' : 'Actualizar'}
          </button>
        </div>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        {busy && !items.length && <div className="ticket-history-loading" role="status"><Icon name="progress_activity" /><span>Consultando el historial de ediciones...</span></div>}
        {loaded && !items.length && !busy && (
          <div className="ticket-history-empty">
            <Icon name="history_toggle_off" />
            <strong>Sin ediciones registradas</strong>
            <p>Cuando se modifiquen los datos de esta boleta, los cambios aparecerán aquí.</p>
          </div>
        )}
        <div className="ticket-history-list">{items.map((entry, index) => <HistoryEntry key={entry.id} entry={entry} index={index} />)}</div>
        {hasMore && <button className="button button--secondary ticket-history-more" type="button"
          disabled={busy} onClick={() => loadHistory(page + 1)}>
          <Icon name="expand_more" /> {busy ? 'Cargando...' : 'Cargar más ediciones'}
        </button>}
        <p className="ticket-history-footnote"><Icon name="info" /> El historial es solo de lectura. Los autoguardados anteriores a la activación de esta función y los cambios que nunca se registraron no pueden reconstruirse.</p>
      </div>
    </section>
  );
}
