import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import KnowledgeCard from '../../components/knowledge/KnowledgeCard';
import usePaginatedResource from '../../hooks/usePaginatedResource';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { normalizeKnowledge } from '../../utils/knowledge';

const PAGE_SIZE = 30;

function canCreateTutorial(hasPermission) {
  return hasPermission('CONOCIMIENTO_CREAR') || hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('BOLETAS_CREAR') || hasPermission('USUARIOS_GESTIONAR');
}

export default function KnowledgeListPage() {
  const { sessionToken, user, hasPermission } = useAuth();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSearch = searchParams.get('q') || '';
  const requestedCategoryId = searchParams.get('category') || '';
  const requestedMineOnly = searchParams.get('mine') === '1';
  const canCreate = canCreateTutorial(hasPermission);
  const canManageCategories = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const canManageAll = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState(requestedSearch);
  const [submittedSearch, setSubmittedSearch] = useState(requestedSearch);
  const [categoryId, setCategoryId] = useState(requestedCategoryId);
  const [mineOnly, setMineOnly] = useState(requestedMineOnly);

  useEffect(() => {
    const controller = new AbortController();
    requestAvailable(MODULE_ROUTES.knowledgeCategories.list, {
      page: 1,
      pageSize: 300,
      activo: true,
      sortBy: 'Nombre',
      sortDir: 'asc',
    }, sessionToken, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setCategories(normalizeItems(data));
    }).catch(() => {});
    return () => controller.abort();
  }, [sessionToken]);

  const fetchTutorials = useCallback(({ page, pageSize, signal }) => requestAvailable(MODULE_ROUTES.knowledge.list, {
    page,
    pageSize,
    search: submittedSearch,
    categoriaId: categoryId,
    autorUsuarioId: mineOnly ? pick(user, ['UsuarioID', 'id']) : '',
    includeDrafts: canManageAll || mineOnly,
    sortBy: 'FechaActualizacion',
    sortDir: 'desc',
  }, sessionToken, { signal }), [canManageAll, categoryId, mineOnly, sessionToken, submittedSearch, user]);

  const {
    items,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    loadFirst,
    loadMore,
  } = usePaginatedResource({
    pageSize: PAGE_SIZE,
    fetchPage: fetchTutorials,
    normalizeResponse: normalizeItems,
    getItemKey: (item, index, source) => normalizeKnowledge(item).id || `${source}-${index}`,
    resetKey: `${sessionToken}|${categoryId}|${mineOnly ? 'mine' : 'all'}|${submittedSearch}`, 
  });

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((record) => {
      const item = normalizeKnowledge(record);
      const categoryText = item.categories.map((category) => category.name).join(' ');
      return `${item.title} ${categoryText} ${item.problem} ${item.author}`.toLowerCase().includes(query);
    });
  }, [items, search]);

  const currentListUrl = `${routeLocation.pathname}${routeLocation.search || ''}`;

  function listReturnState() {
    return {
      knowledgeListReturnTo: currentListUrl,
      knowledgeListScrollY: typeof window === 'undefined' ? 0 : Math.max(0, Number(window.scrollY || 0)),
    };
  }

  function updateListQuery({ nextSearch = submittedSearch, nextCategoryId = categoryId, nextMineOnly = mineOnly } = {}) {
    const next = new URLSearchParams(searchParams);
    if (nextSearch) next.set('q', nextSearch);
    else next.delete('q');
    if (nextCategoryId) next.set('category', nextCategoryId);
    else next.delete('category');
    if (nextMineOnly) next.set('mine', '1');
    else next.delete('mine');
    setSearchParams(next, { replace: true });
  }

  function submit(event) {
    event.preventDefault();
    const nextSearch = search.trim();
    updateListQuery({ nextSearch });
    if (nextSearch === submittedSearch) loadFirst();
    else setSubmittedSearch(nextSearch);
  }

  function changeCategory(nextCategoryId) {
    setCategoryId(nextCategoryId);
    updateListQuery({ nextCategoryId });
  }

  function changeMineOnly(nextMineOnly) {
    setMineOnly(nextMineOnly);
    updateListQuery({ nextMineOnly });
  }

  useEffect(() => {
    const restoreScrollY = Number(routeLocation.state?.restoreScrollY);
    if (loading || !Number.isFinite(restoreScrollY) || restoreScrollY <= 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScrollY, behavior: 'auto' });
      navigate(currentListUrl, { replace: true, state: null });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentListUrl, loading, navigate, routeLocation.state?.restoreScrollY]);

  return <div className="page page--wide knowledge-page">
    <div className="knowledge-hero">
      <div><span className="eyebrow">Documentación técnica</span><h1>Base de conocimientos</h1><p>Tutoriales, procedimientos, videos y documentos creados por el equipo técnico.</p></div>
      <div className="knowledge-hero__actions">
        {canManageCategories && <Link className="button button--secondary button--compact" to="/conocimiento/categorias" state={listReturnState()}><Icon name="category" /> Categorías</Link>}
        {canCreate && <Link className="button button--primary button--compact" to="/conocimiento/nuevo" state={listReturnState()}><Icon name="add" /> Nuevo tutorial</Link>}
      </div>
    </div>

    <form className="knowledge-search" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por problema, producto o procedimiento..." aria-label="Buscar en la base de conocimientos" enterKeyHint="search" autoComplete="off" />
      <button className="icon-button icon-button--primary" type="submit" aria-label="Buscar"><Icon name="arrow_forward" /></button>
    </form>

    <div className="knowledge-filter-row">
      <button type="button" className={!categoryId ? 'is-active' : ''} onClick={() => changeCategory('')}>Todos</button>
      {categories.map((category) => {
        const id = String(pick(category, ['CategoriaConocimientoID', 'CategoriaID', 'id']));
        return <button type="button" key={id} className={categoryId === id ? 'is-active' : ''} onClick={() => changeCategory(id)}>{pick(category, ['Nombre', 'name'], 'Categoría')}</button>;
      })}
      <label className="knowledge-mine-toggle"><input type="checkbox" checked={mineOnly} onChange={(event) => changeMineOnly(event.target.checked)} /><span><Icon name="person" /> Mis tutoriales</span></label>
    </div>

    {error && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando documentación...</span></div> : visibleItems.length ? <>
      <div className="ticket-list-result-count"><span>Mostrando <strong>{visibleItems.length}</strong>{total > visibleItems.length ? ` de ${total}` : ''} tutoriales</span></div>
      <div className="knowledge-grid">{visibleItems.map((item, index) => <KnowledgeCard key={normalizeKnowledge(item).id || index} record={item} navigationState={listReturnState()} />)}</div>
      {hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={loadMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más tutoriales'}</button></div>}
    </> : <div className="empty-state"><Icon name="menu_book" /><h2>No hay tutoriales disponibles</h2><p>{canCreate ? 'Crea el primer documento técnico del equipo.' : 'Los tutoriales publicados aparecerán aquí.'}</p></div>}
  </div>;
}
