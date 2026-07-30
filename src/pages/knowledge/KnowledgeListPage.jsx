import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const canCreate = canCreateTutorial(hasPermission);
  const canManageCategories = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const canManageAll = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

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
    search: search.trim(),
    categoriaId: categoryId,
    autorUsuarioId: mineOnly ? pick(user, ['UsuarioID', 'id']) : '',
    includeDrafts: canManageAll || mineOnly,
    sortBy: 'FechaActualizacion',
    sortDir: 'desc',
  }, sessionToken, { signal }), [canManageAll, categoryId, mineOnly, search, sessionToken, user]);

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
    resetKey: `${sessionToken}|${categoryId}|${mineOnly ? 'mine' : 'all'}`,
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

  function submit(event) {
    event.preventDefault();
    loadFirst();
  }

  return <div className="page knowledge-page">
    <div className="knowledge-hero">
      <div><span className="eyebrow">Documentación técnica</span><h1>Base de conocimientos</h1><p>Tutoriales, procedimientos, videos y documentos creados por el equipo técnico.</p></div>
      <div className="knowledge-hero__actions">
        {canManageCategories && <Link className="button button--secondary button--compact" to="/conocimiento/categorias"><Icon name="category" /> Categorías</Link>}
        {canCreate && <Link className="button button--primary button--compact" to="/conocimiento/nuevo"><Icon name="add" /> Nuevo tutorial</Link>}
      </div>
    </div>

    <form className="knowledge-search" onSubmit={submit}>
      <Icon name="search" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por problema, producto o procedimiento..." />
      <button className="icon-button icon-button--primary" aria-label="Buscar"><Icon name="search" /></button>
    </form>

    <div className="knowledge-filter-row">
      <button type="button" className={!categoryId ? 'is-active' : ''} onClick={() => setCategoryId('')}>Todos</button>
      {categories.map((category) => {
        const id = String(pick(category, ['CategoriaConocimientoID', 'CategoriaID', 'id']));
        return <button type="button" key={id} className={categoryId === id ? 'is-active' : ''} onClick={() => setCategoryId(id)}>{pick(category, ['Nombre', 'name'], 'Categoría')}</button>;
      })}
      <label className="knowledge-mine-toggle"><input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} /><span><Icon name="person" /> Mis tutoriales</span></label>
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando documentación...</span></div> : visibleItems.length ? <>
      <div className="ticket-list-result-count"><span>Mostrando <strong>{visibleItems.length}</strong>{total > visibleItems.length ? ` de ${total}` : ''} tutoriales</span></div>
      <div className="knowledge-grid">{visibleItems.map((item, index) => <KnowledgeCard key={normalizeKnowledge(item).id || index} record={item} />)}</div>
      {hasMore && <div className="list-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={loadMore}><Icon name={loadingMore ? 'progress_activity' : 'expand_more'} />{loadingMore ? 'Cargando...' : 'Cargar más tutoriales'}</button></div>}
    </> : <div className="empty-state"><Icon name="menu_book" /><h2>No hay tutoriales disponibles</h2><p>{canCreate ? 'Crea el primer documento técnico del equipo.' : 'Los tutoriales publicados aparecerán aquí.'}</p></div>}
  </div>;
}
