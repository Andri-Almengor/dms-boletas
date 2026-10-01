import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  patchMaintenanceItemsForQuery,
} from '../../services/maintenanceSyncDomain';
import {
  requestSynchronizedCollection,
  subscribeSyncResource,
} from '../../services/syncManager';
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
function readMaintenanceFilters(params) {
  return {
    client: String(params.get('cliente') || ''),
    dateFrom: String(params.get('desde') || ''),
    dateTo: String(params.get('hasta') || ''),
  };
}
function buildMaintenanceListSearch(status, search, filters) {
  const params = new URLSearchParams();
  params.set('estado', status);
  const query = String(search || '').trim();
  if (query) params.set('q', query);
  if (filters.client) params.set('cliente', filters.client);
  if (filters.dateFrom) params.set('desde', filters.dateFrom);
  if (filters.dateTo) params.set('hasta', filters.dateTo);
  return params.toString();
}

export default function MaintenanceListPage() {
  const { sessionToken, user, permissions, hasPermission, securityRevision } = useAuth();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [searchParams] = useSearchParams();
  const requestedStatus = normalizeMaintenanceStatus(searchParams.get('estado'));
  const initialFilters = readMaintenanceFilters(searchParams);
  const initialSearch = String(searchParams.get('q') || '');
  const canCreate = hasPermission('MANTENIMIENTOS_CREAR') || hasPermission('BOLETAS_CREAR');
  const [status, setStatus] = useState(requestedStatus);
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [clientOptions, setClientOptions] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);

  useEffect(() => { setStatus(requestedStatus); }, [requestedStatus]);

  const resource = usePaginatedResource({
    pageSize: PAGE_SIZE,
    resetKey: `${sessionToken}|${status}|${securityRevision}|${appliedSearch}|${JSON.stringify(appliedFilters)}`,
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
        return await requestSynchronizedCollection(
          MODULE_ROUTES.maintenance.list,
          payload,
          sessionToken,
          {
            resource: 'maintenance',
            userId: user?.UsuarioID,
            permissions,
            signal,
          },
        );
      } catch (loadError) {
        if (isNetworkError(loadError)) return readOfflineMaintenancePage(query);
        throw loadError;
      }
    },
  });
  const {
    items: records,
    setItems,
    page,
    total,
    setTotal,
    hasMore,
    setHasMore,
    loading,
    loadingMore,
    error,
    setError,
    loadMore,
    reload,
    clear,
  } = resource;

  useEffect(() => subscribeSyncResource('maintenance', ({ type, delta }) => {
    if (type === 'security-invalidated') {
      clear();
      return;
    }
    if (type === 'snapshot' || delta?.queryReconcileRequired) {
      reload();
      return;
    }
    if (type !== 'delta' || !delta) return;
    const query = maintenanceListPayload({
      page: 1,
      pageSize: PAGE_SIZE,
      status,
      search: appliedSearch,
      filters: appliedFilters,
    });
    const loadedLimit = Math.max(PAGE_SIZE, page * PAGE_SIZE, records.length);
    setItems((current) => patchMaintenanceItemsForQuery(current, query, delta, loadedLimit));

    const hasFilters = Boolean(appliedSearch || Object.values(appliedFilters).some(Boolean));
    if (!hasFilters && delta.counts) {
      const nextTotal = status === 'PENDIENTE'
        ? Number(delta.counts.pending)
        : Number(delta.counts.finished);
      if (Number.isFinite(nextTotal) && nextTotal >= 0) {
        setTotal(nextTotal);
        setHasMore(nextTotal > loadedLimit);
      }
    }
  }), [appliedFilters, appliedSearch, clear, page, records.length, reload, setHasMore, setItems, setTotal, status]);

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

  const currentListUrl = `${routeLocation.pathname}${routeLocation.search || ''}`;

  function syncListUrl(nextStatus, nextSearch, nextFilters) {
    const query = buildMaintenanceListSearch(nextStatus, nextSearch, nextFilters);
    navigate(`${routeLocation.pathname}?${query}`, { replace: true });
  }
  function selectStatus(nextStatus) {
    setStatus(nextStatus);
    syncListUrl(nextStatus, appliedSearch, appliedFilters);
  }
  function openFilters() { setDraftFilters({ ...filters }); setError(''); setFilterOpen(true); ensureClients(); }
  function setDraftFilter(name, value) { setDraftFilters((current) => ({ ...current, [name]: value })); }
  function applyFilters() { if (invalidDateRange(draftFilters)) { setError('La fecha inicial no puede ser posterior a la fecha final.'); return; } const next = { ...draftFilters }; setFilters(next); setFilterOpen(false); setAppliedSearch(search); setAppliedFilters(next); syncListUrl(status, search, next); }
  function clearFilters() { setFilters({ ...EMPTY_FILTERS }); setDraftFilters({ ...EMPTY_FILTERS }); setFilterOpen(false); setAppliedSearch(search); setAppliedFilters({ ...EMPTY_FILTERS }); syncListUrl(status, search, EMPTY_FILTERS); }
  function submitSearch(event) { event.preventDefault(); const next = { ...filters }; setAppliedSearch(search); setAppliedFilters(next); syncListUrl(status, search, next); }
  function listReturnState() { return { maintenanceListReturnTo: currentListUrl, maintenanceListScrollY: typeof window === 'undefined' ? 0 : Math.max(0, Number(window.scrollY || 0)) }; }
  function openCard(event, detailUrl) { if (!detailUrl || event.target.closest('a, button, input, select, textarea, label')) return; navigate(detailUrl, { state: listReturnState() }); }
  function openCardWithKeyboard(event, detailUrl) { if (!detailUrl || !['Enter',' '].includes(event.key)) return; event.preventDefault(); navigate(detailUrl, { state: listReturnState() }); }
  function openDetailLink(event, detailUrl) { event.preventDefault(); navigate(detailUrl, { state: listReturnState() }); }
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const appliedFilterCount = Object.values(appliedFilters).filter(Boolean).length;
  const offlineUnavailable = !loading
    && !records.length
    && error === OFFLINE_MAINTENANCE_NOT_DOWNLOADED_MESSAGE;

  return <div className="page page--wide maintenance-page">
    <div className="list-page-heading maintenance-heading"><div><span className="eyebrow">Gestión técnica</span><h1>Mantenimientos</h1><p>Inspecciones por dispositivo, evidencias y reportes.</p></div>{canCreate && <Link className="button button--primary button--compact" to="/mantenimientos/nuevo"><Icon name="add" />Nuevo</Link>}</div>
    <div className="maintenance-status-tabs" role="tablist"><button type="button" className={status === 'PENDIENTE' ? 'is-active' : ''} onClick={() => selectStatus('PENDIENTE')}><Icon name="pending_actions" />Pendientes</button><button type="button" className={status === 'FINALIZADO' ? 'is-active' : ''} onClick={() => selectStatus('FINALIZADO')}><Icon name="task_alt" />Finalizados</button></div>
    <form className="search-bar maintenance-list-search-bar" onSubmit={submitSearch} role="search"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar título, cliente o responsable..." aria-label="Buscar mantenimientos" enterKeyHint="search" autoComplete="off" /><button type="submit" className="icon-button maintenance-list-search-submit" aria-label="Buscar mantenimientos"><Icon name="arrow_forward" /></button><button type="button" className="icon-button icon-button--primary filter-trigger" onClick={openFilters} aria-label="Abrir filtros de mantenimientos" aria-expanded={filterOpen}><Icon name="tune" className="filter-trigger__glyph" />{activeFilterCount > 0 && <span className="filter-trigger__count">{activeFilterCount}</span>}</button></form>
    <div className="maintenance-results-summary" aria-live="polite"><span>Mostrando <strong>{records.length}</strong>{total > records.length ? ` de ${total}` : ''} mantenimiento{total === 1 ? '' : 's'}</span><div className="maintenance-results-summary__actions">{appliedSearch && <span className="maintenance-query-chip"><Icon name="search" />Búsqueda activa</span>}{appliedFilterCount > 0 && <button className="maintenance-query-chip" type="button" onClick={openFilters}><Icon name="tune" />{appliedFilterCount} filtro{appliedFilterCount === 1 ? '' : 's'}</button>}<button className="icon-button icon-button--outlined" type="button" onClick={reload} disabled={loading} aria-label="Actualizar mantenimientos"><Icon name={loading ? 'progress_activity' : 'refresh'} /></button></div></div>
    {error && !offlineUnavailable && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimientos...</div> : <><div className="maintenance-grid">{records.length ? records.map((row,index) => { const id = maintenanceRecordId(row,index); const completed = Number(pick(row,['DispositivosRegistrados','CantidadDispositivos'],0)); const expected = expectedDeviceTotal(row); const detailUrl = id ? `/mantenimientos/${encodeURIComponent(id)}` : ''; const rowStatus = String(pick(row,['Estado'],status)).toUpperCase(); return <article className={`maintenance-card${detailUrl ? ' detail-clickable-card' : ''}`} key={id} onClick={(event) => openCard(event,detailUrl)} onKeyDown={(event) => openCardWithKeyboard(event,detailUrl)} role={detailUrl ? 'link' : undefined} tabIndex={detailUrl ? 0 : undefined} aria-label={detailUrl ? `Abrir detalle del mantenimiento ${pick(row,['TituloMantenimiento'],'')}` : undefined}><div className="maintenance-card__top"><span className="maintenance-card__icon"><Icon name="engineering" /></span><span className={`status-chip ${rowStatus === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{rowStatus}</span></div><div><span className="eyebrow">{pick(row,['Cliente','ClienteRef'],'Sin cliente')}</span><h2>{pick(row,['TituloMantenimiento'],'Mantenimiento sin título')}</h2><p>{pick(row,['DescripcionGeneral'],'Sin descripción general')}</p></div><div className="maintenance-card__meta"><span><Icon name="calendar_month" />{formatDate(pick(row,['Fecha']))}</span><span><Icon name="groups" />{pick(row,['Responsables','Responsable'],'Sin responsables')}</span><span><Icon name="location_on" />{pick(row,['Ubicacion'],'Sin ubicación')}</span></div><div className="maintenance-progress-mini"><div><strong>{completed}</strong><span>registrados</span></div><div><strong>{expected}</strong><span>esperados</span></div></div><Link className="button button--primary" to={detailUrl} onClick={(event) => openDetailLink(event, detailUrl)}>Ver detalle<Icon name="chevron_right" /></Link></article>; }) : offlineUnavailable ? <div className="empty-state"><Icon name="cloud_off" /><h2>Mantenimientos no descargados</h2><p>Conecte el dispositivo una vez y actualice la base operativa antes de trabajar sin internet.</p><Link className="button button--primary" to="/mas/contenido-offline"><Icon name="download_for_offline" />Preparar contenido sin conexión</Link></div> : <div className="empty-state"><Icon name="engineering" /><h2>Sin mantenimientos {status === 'PENDIENTE' ? 'pendientes' : 'finalizados'}</h2><p>No se encontraron registros con los filtros actuales.</p></div>}</div>{hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={loadMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más mantenimientos'}</button></div>}</>}
    <FilterDrawer open={filterOpen} title="Filtros de mantenimientos" onClose={() => setFilterOpen(false)} onApply={applyFilters} onClear={clearFilters}>{filterLoading && <div className="info-box"><Icon name="progress_activity" /><p>Cargando clientes disponibles...</p></div>}<label className="field-group"><span className="field-label">Cliente</span><select className="form-control" value={draftFilters.client} onChange={(event) => setDraftFilter('client',event.target.value)}><option value="">Todos los clientes</option>{clientOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><div className="ticket-form-grid"><label className="field-group"><span className="field-label">Desde</span><input className="form-control" type="date" value={draftFilters.dateFrom} max={draftFilters.dateTo || undefined} onChange={(event) => setDraftFilter('dateFrom',event.target.value)} /></label><label className="field-group"><span className="field-label">Hasta</span><input className="form-control" type="date" value={draftFilters.dateTo} min={draftFilters.dateFrom || undefined} onChange={(event) => setDraftFilter('dateTo',event.target.value)} /></label></div></FilterDrawer>
  </div>;
}
