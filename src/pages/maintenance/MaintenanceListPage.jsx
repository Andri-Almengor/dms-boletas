import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(date);
}

function dateKey(value) {
  if (!value) return '';
  const text = String(value);
  const isoMatch = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getId(row) {
  return String(pick(row, ['MantenimientoID', 'id', 'RowID'], ''));
}

export default function MaintenanceListPage() {
  const { sessionToken, hasPermission } = useAuth();
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('PENDIENTE');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRecords(normalizeItems(await requestAvailable(
        MODULE_ROUTES.maintenance.list,
        { page: 1, pageSize: 1000, activo: true },
        sessionToken,
      )));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  const clientOptions = useMemo(() => Array.from(new Set(records
    .map((row) => String(pick(row, ['Cliente', 'ClienteRef'], '')).trim())
    .filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'es')), [records]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((row) => {
      const rowStatus = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
      if (rowStatus !== status) return false;

      const rowClient = String(pick(row, ['Cliente', 'ClienteRef'], '')).trim();
      if (client && rowClient !== client) return false;

      const rowDate = dateKey(pick(row, ['Fecha']));
      if (dateFrom && (!rowDate || rowDate < dateFrom)) return false;
      if (dateTo && (!rowDate || rowDate > dateTo)) return false;

      if (!query) return true;
      return [
        pick(row, ['TituloMantenimiento']),
        rowClient,
        pick(row, ['Responsables', 'Responsable']),
        pick(row, ['DescripcionGeneral']),
      ].join(' ').toLowerCase().includes(query);
    });
  }, [records, status, search, client, dateFrom, dateTo]);

  const hasFilters = Boolean(search || client || dateFrom || dateTo);

  function clearFilters() {
    setSearch('');
    setClient('');
    setDateFrom('');
    setDateTo('');
  }

  return (
    <div className="page maintenance-page">
      <div className="list-page-heading maintenance-heading">
        <div><span className="eyebrow">Gestión técnica</span><h1>Mantenimientos</h1><p>Inspecciones por dispositivo, evidencias y reportes.</p></div>
        {canCreate && <Link className="button button--primary button--compact" to="/mantenimientos/nuevo"><Icon name="add" />Nuevo</Link>}
      </div>

      <div className="maintenance-status-tabs" role="tablist">
        <button type="button" className={status === 'PENDIENTE' ? 'is-active' : ''} onClick={() => setStatus('PENDIENTE')}><Icon name="pending_actions" />Pendientes</button>
        <button type="button" className={status === 'FINALIZADO' ? 'is-active' : ''} onClick={() => setStatus('FINALIZADO')}><Icon name="task_alt" />Finalizados</button>
      </div>

      <section className="maintenance-list-filters" aria-label="Filtros de mantenimiento">
        <label className="maintenance-list-filters__search">
          <span>Buscar</span>
          <div className="knowledge-search maintenance-search">
            <Icon name="search" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Título, cliente o responsable..." />
            <button type="button" className="icon-button" onClick={load} aria-label="Actualizar"><Icon name="refresh" /></button>
          </div>
        </label>

        <label>
          <span>Cliente</span>
          <select className="form-control" value={client} onChange={(event) => setClient(event.target.value)}>
            <option value="">Todos los clientes</option>
            {clientOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>

        <label>
          <span>Desde</span>
          <input className="form-control" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>

        <label>
          <span>Hasta</span>
          <input className="form-control" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
        </label>

        {hasFilters && (
          <button className="button button--ghost button--compact maintenance-list-filters__clear" type="button" onClick={clearFilters}>
            <Icon name="filter_alt_off" />Limpiar
          </button>
        )}
      </section>

      <div className="maintenance-results-summary">
        <span><strong>{filtered.length}</strong> mantenimiento{filtered.length === 1 ? '' : 's'}</span>
        {(client || dateFrom || dateTo) && <span>Filtros aplicados</span>}
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimientos...</div>
      ) : (
        <div className="maintenance-grid">
          {filtered.length ? filtered.map((row) => {
            const id = getId(row);
            const completed = Number(pick(row, ['DispositivosRegistrados', 'CantidadDispositivos'], 0));
            const expected = Number(pick(row, ['DispositivosEsperados', 'CantidadEsperada'], 0));
            return (
              <article className="maintenance-card" key={id}>
                <div className="maintenance-card__top"><span className="maintenance-card__icon"><Icon name="engineering" /></span><span className={`status-chip ${status === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{status}</span></div>
                <div><span className="eyebrow">{pick(row, ['Cliente', 'ClienteRef'], 'Sin cliente')}</span><h2>{pick(row, ['TituloMantenimiento'], 'Mantenimiento sin título')}</h2><p>{pick(row, ['DescripcionGeneral'], 'Sin descripción general')}</p></div>
                <div className="maintenance-card__meta">
                  <span><Icon name="calendar_month" />{formatDate(pick(row, ['Fecha']))}</span>
                  <span><Icon name="groups" />{pick(row, ['Responsables', 'Responsable'], 'Sin responsables')}</span>
                  <span><Icon name="location_on" />{pick(row, ['Ubicacion'], 'Sin ubicación')}</span>
                </div>
                <div className="maintenance-progress-mini"><div><strong>{completed}</strong><span>registrados</span></div><div><strong>{expected || completed}</strong><span>esperados</span></div></div>
                <Link className="button button--primary" to={`/mantenimientos/${encodeURIComponent(id)}`}>Ver detalle<Icon name="chevron_right" /></Link>
              </article>
            );
          }) : (
            <div className="empty-state"><Icon name="engineering" /><h2>Sin mantenimientos {status === 'PENDIENTE' ? 'pendientes' : 'finalizados'}</h2><p>No se encontraron registros con los filtros actuales.</p></div>
          )}
        </div>
      )}
    </div>
  );
}
