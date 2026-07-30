import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import FilterDrawer from '../../components/forms/FilterDrawer';
import TicketCard from '../../components/tickets/TicketCard';
import usePaginatedResource from '../../hooks/usePaginatedResource';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { getTicketId, groupTicketsByDate, normalizeTicketStatus } from '../../utils/tickets';

const TICKET_PAGE_SIZE = 50;
const EMPTY_FILTERS = { clienteId: '', dateFrom: '', dateTo: '', asignadoUsuarioId: '', categoriaId: '', tipoDispositivoId: '', fabricanteId: '', modeloId: '' };

function Select({ label, value, onChange, options }) {
  return <label className="field-group"><span className="field-label">{label}</span><select className="form-control" value={value} onChange={onChange}><option value="">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function options(records, idKeys, labelKeys) { return records.map((record) => ({ value: String(pick(record, idKeys)), label: pick(record, labelKeys) })).filter((item) => item.value && item.label); }
function invalidDateRange(filters) { return Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo); }
function ticketKey(ticket, index, source) { return getTicketId(ticket, `${source}-${index}`); }

export default function TicketListPage({ status }) {
  const { sessionToken, user, hasPermission } = useAuth();
  const isAdmin = hasPermission('BOLETAS_ELIMINAR') || hasPermission('USUARIOS_GESTIONAR');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [catalogs, setCatalogs] = useState({ clients: [], users: [], categories: [], deviceTypes: [], manufacturers: [], models: [] });
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const catalogsRequestStarted = useRef(false);
  const isPending = status === 'PENDIENTE';

  const resource = usePaginatedResource({
    pageSize: TICKET_PAGE_SIZE,
    resetKey: `${sessionToken}|${status}|${isAdmin}|${user?.UsuarioID || ''}|${appliedSearch}|${JSON.stringify(appliedFilters)}`,
    getItemKey: ticketKey,
    normalizeResponse: (data) => {
      let items = normalizeItems(data).filter((item) => normalizeTicketStatus(item) === status);
      if (appliedFilters.fabricanteId) items = items.filter((item) => String(pick(item, ['FabricanteID'])) === String(appliedFilters.fabricanteId));
      if (appliedFilters.modeloId) items = items.filter((item) => String(pick(item, ['ModeloID'])) === String(appliedFilters.modeloId));
      return items;
    },
    fetchPage: ({ page, pageSize, signal }) => requestAvailable(MODULE_ROUTES.tickets.list, {
      page, pageSize, search: appliedSearch, estado: status === 'FINALIZADA' ? 'FINALIZADO' : status, status,
      dateFrom: appliedFilters.dateFrom, dateTo: appliedFilters.dateTo, clienteId: appliedFilters.clienteId,
      categoriaId: appliedFilters.categoriaId, tipoDispositivoId: appliedFilters.tipoDispositivoId,
      fabricanteId: appliedFilters.fabricanteId, modeloId: appliedFilters.modeloId,
      asignadoUsuarioId: isAdmin ? appliedFilters.asignadoUsuarioId : user?.UsuarioID,
      sortBy: 'Fecha', sortDir: 'desc',
    }, sessionToken, { signal }),
  });
  const { items: tickets, page, total, hasMore, loading, loadingMore, error, setError, loadMore, reload } = resource;

  useEffect(() => {
    if (!filterOpen || catalogsLoaded || catalogsRequestStarted.current || !sessionToken) return undefined;
    const controller = new AbortController();
    catalogsRequestStarted.current = true;
    setCatalogsLoading(true);
    const jobs = [
      ['clients', MODULE_ROUTES.clients.list, { page: 1, pageSize: 250, activo: true }],
      ['categories', MODULE_ROUTES.categories.list, { page: 1, pageSize: 250, activo: true }],
      ['deviceTypes', MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 250, activo: true }],
      ['manufacturers', MODULE_ROUTES.manufacturers.list, { page: 1, pageSize: 250, activo: true }],
      ['models', MODULE_ROUTES.models.list, { page: 1, pageSize: 500, activo: true }],
    ];
    if (isAdmin) jobs.push(['users', ['users.assignment.list', ...MODULE_ROUTES.users.list], { page: 1, pageSize: 250 }]);
    Promise.allSettled(jobs.map(([, routes, payload]) => requestAvailable(routes, payload, sessionToken, { signal: controller.signal })))
      .then((results) => {
        if (controller.signal.aborted) return;
        const next = {};
        results.forEach((result, index) => { if (result.status === 'fulfilled') next[jobs[index][0]] = normalizeItems(result.value); });
        setCatalogs((current) => ({ ...current, ...next }));
        setCatalogsLoaded(true);
      })
      .finally(() => { catalogsRequestStarted.current = false; if (!controller.signal.aborted) setCatalogsLoading(false); });
    return () => controller.abort();
  }, [filterOpen, catalogsLoaded, sessionToken, isAdmin]);

  const groups = useMemo(() => groupTicketsByDate(tickets), [tickets]);
  const clientOptions = useMemo(() => options(catalogs.clients, ['ClienteID', 'id'], ['Nombre', 'Clientes']), [catalogs.clients]);
  const technicianOptions = useMemo(() => options(catalogs.users, ['UsuarioID', 'id'], ['NombreCompleto', 'Nombre']), [catalogs.users]);
  const categoryOptions = useMemo(() => options(catalogs.categories, ['CategoriaID', 'id'], ['Nombre']), [catalogs.categories]);
  const deviceOptions = useMemo(() => options(catalogs.deviceTypes, ['TipoDispositivoID', 'id'], ['Nombre']), [catalogs.deviceTypes]);
  const manufacturerOptions = useMemo(() => options(catalogs.manufacturers, ['FabricanteID', 'id'], ['Nombre']), [catalogs.manufacturers]);
  const modelOptions = useMemo(() => options(catalogs.models.filter((item) => ((!filters.tipoDispositivoId || String(pick(item, ['TipoDispositivoID'])) === String(filters.tipoDispositivoId)) && (!filters.fabricanteId || String(pick(item, ['FabricanteID'])) === String(filters.fabricanteId)))), ['ModeloID', 'id'], ['Nombre']), [catalogs.models, filters.tipoDispositivoId, filters.fabricanteId]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function setFilter(name, value, reset = {}) { setFilters((current) => ({ ...current, [name]: value, ...reset })); }
  function applyFilters() {
    if (invalidDateRange(filters)) { setError('La fecha inicial no puede ser posterior a la fecha final.'); return; }
    setFilterOpen(false); setAppliedSearch(search); setAppliedFilters({ ...filters });
  }
  function clearFilters() { setFilters(EMPTY_FILTERS); setFilterOpen(false); setAppliedSearch(search); setAppliedFilters(EMPTY_FILTERS); }
  function submitSearch(event) {
    event.preventDefault();
    if (invalidDateRange(filters)) { setError('La fecha inicial no puede ser posterior a la fecha final.'); return; }
    setAppliedSearch(search); setAppliedFilters({ ...filters });
  }
  async function annulTicket(ticket) {
    if (!isAdmin || !window.confirm(`¿Anular la boleta #${getTicketId(ticket)}?`)) return;
    try { const boletaUid = pick(ticket, ['BoletaUID', 'TicketUID', 'boletaUid']); await requestAvailable(MODULE_ROUTES.tickets.annul, { boletaUid, estado: 'ANULADO' }, sessionToken); await reload(); }
    catch (err) { setError(err.message); }
  }

  const filterFields = <>
    {catalogsLoading && <div className="info-box"><Icon name="progress_activity" /><p>Cargando opciones de filtros únicamente para esta consulta...</p></div>}
    <Select label="Cliente" value={filters.clienteId} onChange={(event) => setFilter('clienteId', event.target.value)} options={clientOptions} />
    <div className="ticket-form-grid"><label className="field-group"><span className="field-label">Desde</span><input className="form-control" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => setFilter('dateFrom', event.target.value)} /></label><label className="field-group"><span className="field-label">Hasta</span><input className="form-control" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => setFilter('dateTo', event.target.value)} /></label></div>
    {isAdmin && <Select label="Técnico" value={filters.asignadoUsuarioId} onChange={(event) => setFilter('asignadoUsuarioId', event.target.value)} options={technicianOptions} />}
    <Select label="Categoría" value={filters.categoriaId} onChange={(event) => setFilter('categoriaId', event.target.value)} options={categoryOptions} />
    <Select label="Tipo de dispositivo" value={filters.tipoDispositivoId} onChange={(event) => setFilter('tipoDispositivoId', event.target.value, { fabricanteId: '', modeloId: '' })} options={deviceOptions} />
    <Select label="Fabricante" value={filters.fabricanteId} onChange={(event) => setFilter('fabricanteId', event.target.value, { modeloId: '' })} options={manufacturerOptions} />
    <Select label="Modelo" value={filters.modeloId} onChange={(event) => setFilter('modeloId', event.target.value)} options={modelOptions} />
  </>;

  return <div className="page ticket-list-page">
    <div className="list-page-heading"><div><span className="eyebrow">Gestión de servicios</span><h1>{isPending ? 'Boletas pendientes' : 'Boletas finalizadas'}</h1><p>{isPending ? 'Servicios que todavía requieren atención o cierre.' : 'Historial de trabajos completados.'}</p></div>{isPending && hasPermission('BOLETAS_CREAR') && <Link className="button button--primary button--compact" to="/boletas/nueva"><Icon name="add" /> Nueva</Link>}</div>
    <form className="search-bar" onSubmit={submitSearch}><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar boleta o cliente..." /><button type="button" className="icon-button icon-button--primary filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros"><Icon name="tune" className="filter-trigger__glyph" />{activeFilterCount > 0 && <span className="filter-trigger__count">{activeFilterCount}</span>}</button></form>
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boletas...</span></div> : tickets.length ? <><div className="ticket-list-result-count"><span>Mostrando <strong>{tickets.length}</strong>{total > tickets.length ? ` de ${total}` : ''} boletas</span></div><div className="ticket-date-groups">{groups.map((group) => <section className="ticket-date-group" key={group.label}><h2>{group.label}</h2><div className="ticket-stack">{group.items.map((ticket, index) => <TicketCard key={getTicketId(ticket, index)} ticket={ticket} onDelete={isAdmin ? annulTicket : undefined} />)}</div></section>)}</div>{hasMore && <div className="ticket-list-load-more"><button type="button" className="button button--secondary" onClick={loadMore} disabled={loadingMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más boletas'}</button></div>}</> : <div className="empty-state"><Icon name={isPending ? 'pending_actions' : 'task_alt'} /><h2>{isPending ? 'No hay boletas pendientes' : 'No hay boletas finalizadas'}</h2><p>{error ? 'Revisa la conexión con el backend.' : 'Los registros aparecerán aquí automáticamente.'}</p></div>}
    <FilterDrawer open={filterOpen} title="Filtros de boletas" onClose={() => setFilterOpen(false)} onApply={applyFilters} onClear={clearFilters}>{filterFields}</FilterDrawer>
  </div>;
}
