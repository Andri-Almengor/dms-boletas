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

function TicketHistoryValue({ value, present }) {
  if (!present) {
    return <span className="ticket-history-value ticket-history-value--unknown"><Icon name="help_outline" /> No conservado en el registro</span>;
  }
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    return <span className="ticket-history-value ticket-history-value--empty">Sin dato</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="ticket-history-value ticket-history-value--boolean">
      <Icon name={value ? 'check_circle' : 'cancel'} />{value ? 'Sí' : 'No'}
    </span>;
  }
  if (Array.isArray(value)) {
    return <span className="ticket-history-value-list">
      {value.map((item, index) => <span className="ticket-history-value-chip" key={`${index}-${item}`}>{String(item)}</span>)}
    </span>;
  }
  return <span className="ticket-history-value">{String(value)}</span>;
}

function hasField(snapshot, field) {
  return Object.prototype.hasOwnProperty.call(snapshot, field);
}

function hasChanged(before, after, field) {
  return JSON.stringify(before[field]) !== JSON.stringify(after[field]);
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return String(value || 'Sin fecha');
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica',
  }).format(date);
}

function TicketHistoryComparison({ before, after, fields }) {
  if (!fields.length) {
    return <p className="ticket-history-muted ticket-history-diff__empty">No se conservaron datos para comparar en esta edición.</p>;
  }
  return (
    <div className="ticket-history-diff" aria-label="Comparación de versiones de la boleta">
      <div className="ticket-history-diff__header" aria-hidden="true">
        <span className="ticket-history-diff__header-field">Campo de la boleta</span>
        <span className="ticket-history-diff__header-before"><Icon name="history" /> Antes <small>Versión anterior</small></span>
        <span className="ticket-history-diff__header-after"><Icon name="task_alt" /> Después <small>Versión guardada</small></span>
      </div>
      {fields.map((field) => {
        const changed = hasChanged(before, after, field);
        const fieldName = fieldLabel(field);
        return (
          <div className={`ticket-history-diff__row${changed ? ' ticket-history-diff__row--changed' : ''}`} key={field}>
            <div className="ticket-history-diff__field">
              <strong>{fieldName}</strong>
              {changed && <span>{hasField(before, field) && hasField(after, field) ? 'Modificado' : 'Registro parcial'}</span>}
            </div>
            <div className="ticket-history-diff__cell ticket-history-diff__cell--before" aria-label={`Antes: ${fieldName}`}>
              <span className="ticket-history-diff__mobile-label"><Icon name="history" /> Antes</span>
              <TicketHistoryValue value={before[field]} present={hasField(before, field)} />
            </div>
            <div className="ticket-history-diff__cell ticket-history-diff__cell--after" aria-label={`Después: ${fieldName}`}>
              <span className="ticket-history-diff__mobile-label"><Icon name="task_alt" /> Después</span>
              <TicketHistoryValue value={after[field]} present={hasField(after, field)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryEntry({ entry, index }) {
  const [showAll, setShowAll] = useState(false);
  const before = entry.antes || {};
  const after = entry.despues || {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = fields.filter((field) => hasChanged(before, after, field));
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
        <div className="ticket-history-review">
          <div className="ticket-history-review__intro">
            <span className="ticket-history-review__icon"><Icon name="difference" /></span>
            <div>
              <strong>Comparación de versiones</strong>
              <p>Identifique qué había antes de guardar y qué quedó registrado después de la edición.</p>
            </div>
          </div>
          <div className="ticket-history-review__switch" role="group" aria-label="Campos del historial a mostrar">
            <button type="button" className={!showAll ? 'is-active' : ''}
              aria-pressed={!showAll} onClick={() => setShowAll(false)}>
              <Icon name="difference" /> Solo cambios
            </button>
            <button type="button" className={showAll ? 'is-active' : ''}
              aria-pressed={showAll} onClick={() => setShowAll(true)}>
              <Icon name="view_list" /> Todos los campos
            </button>
          </div>
        </div>
        {changed.length === 0 && !showAll && (
          <p className="ticket-history-muted ticket-history-review__note">
            Esta edición histórica no conserva diferencias de campos visibles; puede incluir modificaciones o asignaciones que no se registraban en versiones anteriores.
          </p>
        )}
        {(changed.length > 0 || showAll) && (
          <TicketHistoryComparison before={before} after={after} fields={showAll ? fields : changed} />
        )}
        <p className="ticket-history-review__help">
          <Icon name="info" /> Los valores «No conservado en el registro» no equivalen a un campo vacío: la auditoría antigua puede contener información parcial.
        </p>
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
