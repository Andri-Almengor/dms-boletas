import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import FilterDrawer from '../../components/forms/FilterDrawer';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const MAINTENANCE_COUNT_FIELDS = [
  'CantCámaras',
  'CantPuertas',
  'CantServidores',
  'CantGrabadores',
  'CantBocinas',
  'CantSensoresPerimetrales',
  'CantSensoresMovimiento',
  'CantSensorRuptura',
  'CantImpresora',
  'CantGabinetes',
  'CantVideoWall',
];

const EMPTY_FILTERS = Object.freeze({
  client: '',
  dateFrom: '',
  dateTo: '',
});

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

function safeCount(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function expectedDeviceTotal(row = {}) {
  let storedCounts = {};
  try {
    storedCounts = typeof row.CantidadesJSON === 'string'
      ? JSON.parse(row.CantidadesJSON || '{}')
      : (row.CantidadesJSON || {});
  } catch {
    storedCounts = {};
  }

  const validStoredCounts = storedCounts && typeof storedCounts === 'object' && !Array.isArray(storedCounts)
    ? storedCounts
    : {};
  const storedEntries = Object.entries(validStoredCounts);
  let hasCategoryCounts = storedEntries.length > 0;
  let total = storedEntries.reduce((sum, [, value]) => sum + safeCount(value), 0);

  // Los mantenimientos históricos pueden tener cantidades solo en columnas físicas.
  // Se agregan únicamente cuando la misma clave no existe en CantidadesJSON para evitar duplicarlas.
  for (const field of MAINTENANCE_COUNT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(validStoredCounts, field)) continue;
    const source = row[field];
    if (source === undefined || source === null || source === '') continue;
    hasCategoryCounts = true;
    total += safeCount(source);
  }

  if (hasCategoryCounts) return total;

  for (const key of ['DispositivosEsperados', 'CantidadEsperada']) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      const direct = Number(row[key]);
      if (Number.isFinite(direct)) return Math.max(0, direct);
    }
  }

  return 0;
}

function invalidDateRange(filters) {
  return Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);
}

export default function MaintenanceListPage() {
  const { sessionToken, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('PENDIENTE');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
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
      if (filters.client && rowClient !== filters.client) return false;

      const rowDate = dateKey(pick(row, ['Fecha']));
      if (filters.dateFrom && (!rowDate || rowDate < filters.dateFrom)) return false;
      if (filters.dateTo && (!rowDate || rowDate > filters.dateTo)) return false;

      if (!query) return true;
      return [
        pick(row, ['TituloMantenimiento']),
        rowClient,
        pick(row, ['Responsables', 'Responsable']),
        pick(row, ['DescripcionGeneral']),
      ].join(' ').toLowerCase().includes(query);
    });
  }, [records, status, search, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function openFilters() {
    setDraftFilters({ ...filters });
    setError('');
    setFilterOpen(true);
  }

  function setDraftFilter(name, value) {
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters() {
    if (invalidDateRange(draftFilters)) {
      setError('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    setFilters({ ...draftFilters });
    setFilterOpen(false);
    setError('');
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setFilterOpen(false);
    setError('');
  }

  function openCard(event, detailUrl) {
    if (!detailUrl || event.target.closest('a, button, input, select, textarea, label')) return;
    navigate(detailUrl);
  }

  function openCardWithKeyboard(event, detailUrl) {
    if (!detailUrl || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(detailUrl);
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

      <form className="search-bar maintenance-list-search-bar" onSubmit={(event) => event.preventDefault()}>
        <Icon name="search" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar título, cliente o responsable..." aria-label="Buscar mantenimientos" />
        <button type="button" className="icon-button icon-button--primary filter-trigger" onClick={openFilters} aria-label="Abrir filtros de mantenimientos">
          <Icon name="tune" className="filter-trigger__glyph" />
          {activeFilterCount > 0 && <span className="filter-trigger__count">{activeFilterCount}</span>}
        </button>
      </form>

      <div className="maintenance-results-summary">
        <span><strong>{filtered.length}</strong> mantenimiento{filtered.length === 1 ? '' : 's'}</span>
        <div className="maintenance-results-summary__actions">
          {activeFilterCount > 0 && <span>Filtros aplicados</span>}
          <button className="icon-button icon-button--outlined" type="button" onClick={load} disabled={loading} aria-label="Actualizar mantenimientos"><Icon name={loading ? 'progress_activity' : 'refresh'} /></button>
        </div>
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimientos...</div>
      ) : (
        <div className="maintenance-grid">
          {filtered.length ? filtered.map((row) => {
            const id = getId(row);
            const completed = Number(pick(row, ['DispositivosRegistrados', 'CantidadDispositivos'], 0));
            const expected = expectedDeviceTotal(row);
            const detailUrl = id ? `/mantenimientos/${encodeURIComponent(id)}` : '';
            return (
              <article
                className={`maintenance-card${detailUrl ? ' detail-clickable-card' : ''}`}
                key={id}
                onClick={(event) => openCard(event, detailUrl)}
                onKeyDown={(event) => openCardWithKeyboard(event, detailUrl)}
                role={detailUrl ? 'link' : undefined}
                tabIndex={detailUrl ? 0 : undefined}
                aria-label={detailUrl ? `Abrir detalle del mantenimiento ${pick(row, ['TituloMantenimiento'], '')}` : undefined}
              >
                <div className="maintenance-card__top"><span className="maintenance-card__icon"><Icon name="engineering" /></span><span className={`status-chip ${status === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{status}</span></div>
                <div><span className="eyebrow">{pick(row, ['Cliente', 'ClienteRef'], 'Sin cliente')}</span><h2>{pick(row, ['TituloMantenimiento'], 'Mantenimiento sin título')}</h2><p>{pick(row, ['DescripcionGeneral'], 'Sin descripción general')}</p></div>
                <div className="maintenance-card__meta">
                  <span><Icon name="calendar_month" />{formatDate(pick(row, ['Fecha']))}</span>
                  <span><Icon name="groups" />{pick(row, ['Responsables', 'Responsable'], 'Sin responsables')}</span>
                  <span><Icon name="location_on" />{pick(row, ['Ubicacion'], 'Sin ubicación')}</span>
                </div>
                <div className="maintenance-progress-mini"><div><strong>{completed}</strong><span>registrados</span></div><div><strong>{expected}</strong><span>esperados</span></div></div>
                <Link className="button button--primary" to={detailUrl}>Ver detalle<Icon name="chevron_right" /></Link>
              </article>
            );
          }) : (
            <div className="empty-state"><Icon name="engineering" /><h2>Sin mantenimientos {status === 'PENDIENTE' ? 'pendientes' : 'finalizados'}</h2><p>No se encontraron registros con los filtros actuales.</p></div>
          )}
        </div>
      )}

      <FilterDrawer open={filterOpen} title="Filtros de mantenimientos" onClose={() => setFilterOpen(false)} onApply={applyFilters} onClear={clearFilters}>
        <label className="field-group">
          <span className="field-label">Cliente</span>
          <select className="form-control" value={draftFilters.client} onChange={(event) => setDraftFilter('client', event.target.value)}>
            <option value="">Todos los clientes</option>
            {clientOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="ticket-form-grid">
          <label className="field-group"><span className="field-label">Desde</span><input className="form-control" type="date" value={draftFilters.dateFrom} max={draftFilters.dateTo || undefined} onChange={(event) => setDraftFilter('dateFrom', event.target.value)} /></label>
          <label className="field-group"><span className="field-label">Hasta</span><input className="form-control" type="date" value={draftFilters.dateTo} min={draftFilters.dateFrom || undefined} onChange={(event) => setDraftFilter('dateTo', event.target.value)} /></label>
        </div>
      </FilterDrawer>
    </div>
  );
}
