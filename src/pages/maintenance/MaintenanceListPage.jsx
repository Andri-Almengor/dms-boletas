import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import FilterDrawer from '../../components/forms/FilterDrawer';
import {
  MAINTENANCE_LIST_PAGE_SIZE,
  maintenanceListPayload,
  maintenanceRecordId,
  matchesMaintenanceListFilters,
  normalizeMaintenanceStatus,
} from '../../features/maintenance/maintenanceListDomain';
import usePaginatedResource from '../../hooks/usePaginatedResource';
import {
  MODULE_ROUTES,
  isNetworkError,
  normalizeItems,
  pick,
  requestAvailable,
} from '../../services/moduleApi';
import {
  OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE,
  readOfflineMaintenancePage,
} from '../../services/offlineMaintenanceData';

const PAGE_SIZE = MAINTENANCE_LIST_PAGE_SIZE;
const MAINTENANCE_COUNT_FIELDS = ['CantCámaras','CantPuertas','CantServidores','CantGrabadores','CantBocinas','CantSensoresPerimetrales','CantSensoresMovimiento','CantSensorRuptura','CantImpresora','CantGabinetes','CantVideoWall'];
const EMPTY_FILTERS = Object.freeze({ client: '', dateFrom: '', dateTo: '' });

function formatDate(value) { if (!value) return 'Sin fecha'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(date); }
function safeCount(value) { const amount = Number(value ?? 0); return Number.isFinite(amount) ? Math.max(0, amount) : 0; }
function expectedDeviceTotal(row = {}) { let storedCounts = {}; try { storedCounts = typeof row.CantidadesJSON === 'string' ? JSON.parse(row.CantidadesJSON || '{}') : (row.CantidadesJSON || {}); } catch { storedCounts = {}; } const valid = storedCounts && typeof storedCounts === 'object' && !Array.isArray(storedCounts) ? storedCounts : {}; const entries = Object.entries(valid); let hasCounts = entries.length > 0; let total = entries.reduce((sum,[,value]) => sum + safeCount(value),0); for (const field of MAINTENANCE_COUNT_FIELDS) { if (Object.prototype.hasOwnProperty.call(valid, field)) continue; const source = row[field]; if (source === undefined || source === null || source === '') continue; hasCounts = true; total += safeCount(source); } if (hasCounts) return total; for (const key of ['DispositivosEsperados','CantidadEsperada']) { const direct = Number(row[key]); if (Number.isFinite(direct)) return Math.max(0,direct); } return 0; }
function invalidDateRange(filters) { return Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo); }
function maintenanceKey(row, index, source) { return maintenanceRecordId(row, `${source}-${index}`); }

export default function MaintenanceListPage() {
  const { sessionToken, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedStatus = normalizeMaintenanceStatus(searchParams.get('estado'));
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const [status, setStatus] = useState(requestedStatus);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [clientOptions, setClientOptions] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);

  useEffect(() => { setStatus(requestedStatus); }, [requestedStatus]);

  const resource = usePaginatedResource({
    pageSize: PAGE_SIZE,
    resetKey: `${sessionToken}|${status}|${appliedSearch}|${JSON.stringify(appliedFilters)}`,
    getItemKey: maintenanceKey,
    normalizeResponse: (data) => normalizeItems(data).filter((row) => (
      matchesMaintenanceListFilters(row, status, appliedSearch, appliedFilters)
    )),
    fetchPage: async ({ page, pageSize, signal }) => {
      const query = {
        page,
        pageSize,
        status,
        search: appliedSearch,
        filters: appliedFilters,
        sessionToken,
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return readOfflineMaintenancePage(query);
      }
      const payload = maintenanceListPayload(query);
      try {
        return await requestAvailable(
          MODULE_ROUTES.maintenance.list,
          payload,
          sessionToken,
          { signal },
        );
      } catch (loadError) {
        if (isNetworkError(loadError)) return readOfflineMaintenancePage(query);
        throw loadError;
      }
    },
  });
  const { items: records, total, hasMore, loading, loadingMore, error, setError, loadMore, reload } = resource;

  async function ensureClients() {
    if (clientOptions.length || filterLoading) return;
    setFilterLoading(true);
    const controller = new AbortController();
    try {
      const data = await requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 300, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken, { signal: controller.signal });
      setClientOptions(Array.from(new Set(normalizeItems(data).map((row) => String(pick(row,['Clientes','Cliente','Nombre'],'')).trim()).filter(Boolean))));
    } catch {
      setClientOptions(Array.from(new Set(records.map((row) => String(pick(row,['Cliente','ClienteRef'],'')).trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b,'es')));
    } finally { setFilterLoading(false); }
  }

  function openFilters() { setDraftFilters({ ...filters }); setError(''); setFilterOpen(true); ensureClients(); }
  function setDraftFilter(name, value) { setDraftFilters((current) => ({ ...current, [name]: value })); }
  function applyFilters() { if (invalidDateRange(draftFilters)) { setError('La fecha inicial no puede ser posterior a la fecha final.'); return; } const next = { ...draftFilters }; setFilters(next); setFilterOpen(false); setAppliedSearch(search); setAppliedFilters(next); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setFilterOpen(false); setAppliedSearch(search); setAppliedFilters(EMPTY_FILTERS); }
  function submitSearch(event) { event.preventDefault(); setAppliedSearch(search); setAppliedFilters({ ...filters }); }
  function openCard(event, detailUrl) { if (!detailUrl || event.target.closest('a, button, input, select, textarea, label')) return; navigate(detailUrl); }
  function openCardWithKeyboard(event, detailUrl) { if (!detailUrl || !['Enter',' '].includes(event.key)) return; event.preventDefault(); navigate(detailUrl); }
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const offlineUnavailable = !loading
    && !records.length
    && error === OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE;

  return <div className="page maintenance-page">
    <div className="list-page-heading maintenance-heading"><div><span className="eyebrow">Gestión técnica</span><h1>Mantenimientos</h1><p>Inspecciones por dispositivo, evidencias y reportes.</p></div>{canCreate && <Link className="button button--primary button--compact" to="/mantenimientos/nuevo"><Icon name="add" />Nuevo</Link>}</div>
    <div className="maintenance-status-tabs" role="tablist"><button type="button" className={status === 'PENDIENTE' ? 'is-active' : ''} onClick={() => setStatus('PENDIENTE')}><Icon name="pending_actions" />Pendientes</button><button type="button" className={status === 'FINALIZADO' ? 'is-active' : ''} onClick={() => setStatus('FINALIZADO')}><Icon name="task_alt" />Finalizados</button></div>
    <form className="search-bar maintenance-list-search-bar" onSubmit={submitSearch}><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar título, cliente o responsable..." aria-label="Buscar mantenimientos" /><button type="submit" className="icon-button" aria-label="Buscar mantenimientos"><Icon name="search" /></button><button type="button" className="icon-button icon-button--primary filter-trigger" onClick={openFilters} aria-label="Abrir filtros de mantenimientos"><Icon name="tune" className="filter-trigger__glyph" />{activeFilterCount > 0 && <span className="filter-trigger__count">{activeFilterCount}</span>}</button></form>
    <div className="maintenance-results-summary"><span>Mostrando <strong>{records.length}</strong>{total > records.length ? ` de ${total}` : ''} mantenimiento{total === 1 ? '' : 's'}</span><div className="maintenance-results-summary__actions">{activeFilterCount > 0 && <span>Filtros aplicados</span>}<button className="icon-button icon-button--outlined" type="button" onClick={reload} disabled={loading} aria-label="Actualizar mantenimientos"><Icon name={loading ? 'progress_activity' : 'refresh'} /></button></div></div>
    {error && !offlineUnavailable && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimientos...</div> : <><div className="maintenance-grid">{records.length ? records.map((row,index) => { const id = maintenanceRecordId(row,index); const completed = Number(pick(row,['DispositivosRegistrados','CantidadDispositivos'],0)); const expected = expectedDeviceTotal(row); const detailUrl = id ? `/mantenimientos/${encodeURIComponent(id)}` : ''; const rowStatus = String(pick(row,['Estado'],status)).toUpperCase(); return <article className={`maintenance-card${detailUrl ? ' detail-clickable-card' : ''}`} key={id} onClick={(event) => openCard(event,detailUrl)} onKeyDown={(event) => openCardWithKeyboard(event,detailUrl)} role={detailUrl ? 'link' : undefined} tabIndex={detailUrl ? 0 : undefined} aria-label={detailUrl ? `Abrir detalle del mantenimiento ${pick(row,['TituloMantenimiento'],'')}` : undefined}><div className="maintenance-card__top"><span className="maintenance-card__icon"><Icon name="engineering" /></span><span className={`status-chip ${rowStatus === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{rowStatus}</span></div><div><span className="eyebrow">{pick(row,['Cliente','ClienteRef'],'Sin cliente')}</span><h2>{pick(row,['TituloMantenimiento'],'Mantenimiento sin título')}</h2><p>{pick(row,['DescripcionGeneral'],'Sin descripción general')}</p></div><div className="maintenance-card__meta"><span><Icon name="calendar_month" />{formatDate(pick(row,['Fecha']))}</span><span><Icon name="groups" />{pick(row,['Responsables','Responsable'],'Sin responsables')}</span><span><Icon name="location_on" />{pick(row,['Ubicacion'],'Sin ubicación')}</span></div><div className="maintenance-progress-mini"><div><strong>{completed}</strong><span>registrados</span></div><div><strong>{expected}</strong><span>esperados</span></div></div><Link className="button button--primary" to={detailUrl}>Ver detalle<Icon name="chevron_right" /></Link></article>; }) : offlineUnavailable ? <div className="empty-state"><Icon name="cloud_off" /><h2>Mantenimientos no descargados</h2><p>Conecte el dispositivo una vez y actualice la base operativa antes de trabajar sin internet.</p><Link className="button button--primary" to="/mas/contenido-offline"><Icon name="download_for_offline" />Preparar contenido sin conexión</Link></div> : <div className="empty-state"><Icon name="engineering" /><h2>Sin mantenimientos {status === 'PENDIENTE' ? 'pendientes' : 'finalizados'}</h2><p>No se encontraron registros con los filtros actuales.</p></div>}</div>{hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={loadMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más mantenimientos'}</button></div>}</>}
    <FilterDrawer open={filterOpen} title="Filtros de mantenimientos" onClose={() => setFilterOpen(false)} onApply={applyFilters} onClear={clearFilters}>{filterLoading && <div className="info-box"><Icon name="progress_activity" /><p>Cargando clientes disponibles...</p></div>}<label className="field-group"><span className="field-label">Cliente</span><select className="form-control" value={draftFilters.client} onChange={(event) => setDraftFilter('client',event.target.value)}><option value="">Todos los clientes</option>{clientOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><div className="ticket-form-grid"><label className="field-group"><span className="field-label">Desde</span><input className="form-control" type="date" value={draftFilters.dateFrom} max={draftFilters.dateTo || undefined} onChange={(event) => setDraftFilter('dateFrom',event.target.value)} /></label><label className="field-group"><span className="field-label">Hasta</span><input className="form-control" type="date" value={draftFilters.dateTo} min={draftFilters.dateFrom || undefined} onChange={(event) => setDraftFilter('dateTo',event.target.value)} /></label></div></FilterDrawer>
  </div>;
}
