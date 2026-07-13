import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import KnowledgeCard from '../../components/knowledge/KnowledgeCard';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import { normalizeKnowledge } from '../../utils/knowledge';

function canCreateTutorial(hasPermission) {
  return hasPermission('CONOCIMIENTO_CREAR') || hasPermission('BOLETAS_CREAR') || hasPermission('USUARIOS_GESTIONAR');
}

export default function KnowledgeListPage() {
  const { sessionToken, user, hasPermission } = useAuth();
  const canCreate = canCreateTutorial(hasPermission);
  const canManageCategories = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const canManageAll = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR');
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [tutorialData, categoryData] = await Promise.all([
        requestAvailable(MODULE_ROUTES.knowledge.list, {
          page: 1,
          pageSize: 500,
          search,
          categoriaId: categoryId,
          autorUsuarioId: mineOnly ? pick(user, ['UsuarioID', 'id']) : '',
          includeDrafts: canManageAll || mineOnly,
          sortBy: 'UpdatedAt',
          sortDir: 'desc',
        }, sessionToken),
        requestAvailable(MODULE_ROUTES.knowledgeCategories.list, { page: 1, pageSize: 300, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
      ]);
      setItems(normalizeItems(tutorialData));
      setCategories(normalizeItems(categoryData));
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sessionToken]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const userId = String(pick(user, ['UsuarioID', 'id'], ''));
    return items.filter((record) => {
      const item = normalizeKnowledge(record);
      if (categoryId && item.categoryId !== String(categoryId)) return false;
      if (mineOnly && item.authorId !== userId) return false;
      if (!query) return true;
      return `${item.title} ${item.category} ${item.problem} ${item.author}`.toLowerCase().includes(query);
    });
  }, [items, search, categoryId, mineOnly, user]);

  function submit(event) {
    event.preventDefault();
    load();
  }

  return <div className="page knowledge-page">
    <div className="knowledge-hero">
      <div>
        <span className="eyebrow">Documentación técnica</span>
        <h1>Base de conocimientos</h1>
        <p>Tutoriales, procedimientos, videos y documentos creados por el equipo técnico.</p>
      </div>
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
    {loading ? <div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando documentación...</span></div> : visibleItems.length ? (
      <div className="knowledge-grid">{visibleItems.map((item, index) => <KnowledgeCard key={normalizeKnowledge(item).id || index} record={item} />)}</div>
    ) : <div className="empty-state"><Icon name="menu_book" /><h2>No hay tutoriales disponibles</h2><p>{canCreate ? 'Crea el primer documento técnico del equipo.' : 'Los tutoriales publicados aparecerán aquí.'}</p></div>}
  </div>;
}
