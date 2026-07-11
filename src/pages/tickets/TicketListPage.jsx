import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import FilterDrawer from '../../components/forms/FilterDrawer';
import TicketCard from '../../components/tickets/TicketCard';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { getTicketId, groupTicketsByDate, normalizeTicketStatus } from '../../utils/tickets';

const EMPTY_FILTERS = { clienteId: '', dateFrom: '', dateTo: '', asignadoUsuarioId: '', categoriaId: '', tipoDispositivoId: '', fabricanteId: '', modeloId: '' };

function Select({ label, value, onChange, options }) {
  return <label className="field-group"><span className="field-label">{label}</span><select className="form-control" value={value} onChange={onChange}><option value="">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function options(records, idKeys, labelKeys) { return records.map((record) => ({ value: String(pick(record, idKeys)), label: pick(record, labelKeys) })).filter((item) => item.value && item.label); }

export default function TicketListPage({ status }) {
  const { sessionToken, user, hasPermission } = useAuth();
  const isAdmin = hasPermission('BOLETAS_ELIMINAR') || hasPermission('USUARIOS_GESTIONAR');
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [catalogs, setCatalogs] = useState({ clients: [], users: [], categories: [], deviceTypes: [], manufacturers: [], models: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isPending = status === 'PENDIENTE';

  useEffect(() => {
    Promise.allSettled([
      requestAvailable(MODULE_ROUTES.clients.list, { page: 1, pageSize: 500, activo: true }, sessionToken),
      requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 500 }, sessionToken),
      requestAvailable(MODULE_ROUTES.categories.list, { page: 1, pageSize: 500, activo: true }, sessionToken),
      requestAvailable(MODULE_ROUTES.deviceTypes.list, { page: 1, pageSize: 500, activo: true }, sessionToken),
      requestAvailable(MODULE_ROUTES.manufacturers.list, { page: 1, pageSize: 500, activo: true }, sessionToken),
      requestAvailable(MODULE_ROUTES.models.list, { page: 1, pageSize: 1000, activo: true }, sessionToken),
    ]).then((results) => {
      const keys = ['clients', 'users', 'categories', 'deviceTypes', 'manufacturers', 'models'];
      const next = {};
      results.forEach((result, index) => { if (result.status === 'fulfilled') next[keys[index]] = normalizeItems(result.value); });
      setCatalogs((current) => ({ ...current, ...next }));
    });
  }, [sessionToken]);

  async function loadTickets(query = search, currentFilters = filters) {
    setLoading(true); setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.tickets.list, {
        page: 1, pageSize: 500, search: query, estado: status === 'FINALIZADA' ? 'FINALIZADO' : status, status,
        dateFrom: currentFilters.dateFrom, dateTo: currentFilters.dateTo, clienteId: currentFilters.clienteId,
        categoriaId: currentFilters.categoriaId, tipoDispositivoId: currentFilters.tipoDispositivoId,
        fabricanteId: currentFilters.fabricanteId, modeloId: currentFilters.modeloId,
        asignadoUsuarioId: isAdmin ? currentFilters.asignadoUsuarioId : user?.UsuarioID,
        sortBy: 'Fecha', sortDir: 'desc',
      }, sessionToken);
      let items = normalizeItems(data).filter((item) => normalizeTicketStatus(item) === status);
      if (currentFilters.fabricanteId) items = items.filter((item) => String(pick(item, ['FabricanteID'])) === String(currentFilters.fabricanteId));
      if (currentFilters.modeloId) items = items.filter((item) => String(pick(item, ['ModeloID'])) === String(currentFilters.modeloId));
      setTickets(items);
    } catch (err) { setError(err.message); setTickets([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadTickets('', EMPTY_FILTERS); }, [sessionToken, status]);

  const groups = useMemo(() => groupTicketsByDate(tickets), [tickets]);
  const clientOptions = options(catalogs.clients, ['ClienteID', 'id'], ['Nombre', 'Clientes']);
  const technicianOptions = options(catalogs.users, ['UsuarioID', 'id'], ['NombreCompleto', 'Nombre']);
  const categoryOptions = options(catalogs.categories, ['CategoriaID', 'id'], ['Nombre']);
  const deviceOptions = options(catalogs.deviceTypes, ['TipoDispositivoID', 'id'], ['Nombre']);
  const manufacturerOptions = options(catalogs.manufacturers, ['FabricanteID', 'id'], ['Nombre']);
  const modelOptions = options(catalogs.models.filter((item) => (!filters.tipoDispositivoId || String(pick(item, ['TipoDispositivoID'])) === String(filters.tipoDispositivoId)) && (!filters.fabricanteId || String(pick(item, ['FabricanteID'])) === String(filters.fabricanteId))), ['ModeloID', 'id'], ['Nombre']);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function setFilter(name, value, reset = {}) { setFilters((current) => ({ ...current, [name]: value, ...reset })); }
  function applyFilters() { setFilterOpen(false); loadTickets(search, filters); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setFilterOpen(false); loadTickets(search, EMPTY_FILTERS); }

  async function annulTicket(ticket) {
    if (!isAdmin || !window.confirm(`¿Anular la boleta #${getTicketId(ticket)}?`)) return;
    try {
      const boletaUid = pick(ticket, ['BoletaUID', 'TicketUID', 'boletaUid']);
      await requestAvailable(MODULE_ROUTES.tickets.annul, { boletaUid, estado: 'ANULADO' }, sessionToken);
      await loadTickets(search, filters);
    } catch (err) { setError(err.message); }
  }

  const filterFields = <>
    <Select label="Cliente" value={filters.clienteId} onChange={(event) => setFilter('clienteId', event.target.value)} options={clientOptions} />
    <div className="ticket-form-grid"><label className="field-group"><span className="field-label">Desde</span><input className="form-control" type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)} /></label><label className="field-group"><span className="field-label">Hasta</span><input className="form-control" type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)} /></label></div>
    {isAdmin && <Select label="Técnico" value={filters.asignadoUsuarioId} onChange={(event) => setFilter('asignadoUsuarioId', event.target.value)} options={technicianOptions} />}
    <Select label="Categoría" value={filters.categoriaId} onChange={(event) => setFilter('categoriaId', event.target.value)} options={categoryOptions} />
    <Select label="Tipo de dispositivo" value={filters.tipoDispositivoId} onChange={(event) => setFilter('tipoDispositivoId', event.target.value, { fabricanteId: '', modeloId: '' })} options={deviceOptions} />
    <Select label="Fabricante" value={filters.fabricanteId} onChange={(event) => setFilter('fabricanteId', event.target.value, { modeloId: '' })} options={manufacturerOptions} />
    <Select label="Modelo" value={filters.modeloId} onChange={(event) => setFilter('modeloId', event.target.value)} options={modelOptions} />
  </>;

  return <div className="page ticket-list-page">
    <div className="list-page-heading"><div><span className="eyebrow">Gestión de servicios</span><h1>{isPending ? 'Boletas pendientes' : 'Boletas finalizadas'}</h1><p>{isPending ? 'Servicios que todavía requieren atención o cierre.' : 'Historial de trabajos completados.'}</p></div>{isPending && hasPermission('BOLETAS_CREAR') && <Link className="button button--primary button--compact" to="/boletas/nueva"><Icon name="add" /> Nueva</Link>}</div>
    <form className="search-bar" onSubmit={(event) => { event.preventDefault(); loadTickets(); }}><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar boleta o cliente..." /><button type="button" className="icon-button icon-button--primary filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros"><Icon name="tune" />{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button></form>
    <div className="desktop-filter-panel">{filterFields}<div className="desktop-filter-actions"><button className="button button--secondary button--compact" type="button" onClick={clearFilters}>Limpiar</button><button className="button button--primary button--compact" type="button" onClick={applyFilters}>Filtrar</button></div></div>
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando boletas...</span></div> : tickets.length ? <div className="ticket-date-groups">{groups.map((group) => <section className="ticket-date-group" key={group.label}><h2>{group.label}</h2><div className="ticket-stack">{group.items.map((ticket, index) => <TicketCard ticket={ticket} key={getTicketId(ticket, index)} onDelete={isAdmin ? annulTicket : undefined} />)}</div></section>)}</div> : <div className="empty-state"><Icon name={isPending ? 'pending_actions' : 'task_alt'} /><h2>{isPending ? 'No hay boletas pendientes' : 'No hay boletas finalizadas'}</h2><p>{error ? 'Revisa la conexión con Apps Script.' : 'Los registros aparecerán aquí automáticamente.'}</p></div>}
    <FilterDrawer open={filterOpen} title="Filtros de boletas" onClose={() => setFilterOpen(false)} onApply={applyFilters} onClear={clearFilters}>{filterFields}</FilterDrawer>
  </div>;
}
