import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import AdminEntityModal from '../../components/forms/AdminEntityModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const TABS = [
  ['categories', 'Categorías', 'category'],
  ['deviceTypes', 'Dispositivos', 'devices'],
  ['manufacturers', 'Fabricantes', 'factory'],
  ['models', 'Modelos', 'view_in_ar'],
  ['failureTypes', 'Tipos de falla', 'warning'],
  ['relations', 'Relaciones', 'account_tree'],
];
const LIST_ROUTES = {
  categories: MODULE_ROUTES.categories.list,
  deviceTypes: MODULE_ROUTES.deviceTypes.list,
  manufacturers: MODULE_ROUTES.manufacturers.list,
  models: MODULE_ROUTES.models.list,
  failureTypes: MODULE_ROUTES.failureTypes.list,
  relations: MODULE_ROUTES.deviceManufacturers.list,
};
const DELETE_ROUTES = {
  categories: ['catalog.categories.delete', 'categories.delete', 'categorias.delete'],
  deviceTypes: ['catalog.deviceTypes.delete', 'deviceTypes.delete', 'tiposDispositivo.delete'],
  manufacturers: ['catalog.manufacturers.delete', 'manufacturers.delete', 'fabricantes.delete'],
  models: ['catalog.models.delete', 'models.delete', 'modelos.delete'],
  failureTypes: ['catalog.failureTypes.delete', 'failureTypes.delete', 'tiposFalla.delete'],
  relations: ['catalog.deviceManufacturers.delete', 'deviceManufacturers.delete', 'tipoDispositivoFabricantes.delete'],
};
const EMPTY_DATA = { categories: [], deviceTypes: [], manufacturers: [], models: [], failureTypes: [], relations: [] };

function TextField({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function Select({ label, records, idKeys, labelKeys, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span><select className="form-control" {...props}><option value="">Seleccione</option>{records.map((record) => <option key={pick(record, idKeys)} value={pick(record, idKeys)}>{pick(record, labelKeys)}</option>)}</select></label>;
}

function emptyValues() {
  return { nombre: '', descripcion: '', tipoDispositivoId: '', fabricanteId: '', imagenReferenciaURL: '' };
}

function valuesFromRecord(tab, record = {}) {
  const values = emptyValues();
  if (tab === 'relations') {
    values.tipoDispositivoId = String(pick(record, ['TipoDispositivoID'], ''));
    values.fabricanteId = String(pick(record, ['FabricanteID'], ''));
    return values;
  }
  values.nombre = pick(record, ['Nombre', 'Categoria', 'TipoDispositivo', 'Fabricante', 'Modelo', 'TipoFalla']);
  values.descripcion = pick(record, ['Descripcion']);
  values.tipoDispositivoId = String(pick(record, ['TipoDispositivoID'], ''));
  values.fabricanteId = String(pick(record, ['FabricanteID'], ''));
  values.imagenReferenciaURL = pick(record, ['ImagenReferenciaURL']);
  return values;
}

function payloadFromValues(tab, values) {
  if (tab === 'relations') return { tipoDispositivoId: values.tipoDispositivoId, fabricanteId: values.fabricanteId };
  const payload = { nombre: values.nombre, descripcion: values.descripcion };
  if (tab === 'models') {
    payload.tipoDispositivoId = values.tipoDispositivoId;
    payload.fabricanteId = values.fabricanteId;
    payload.imagenReferenciaURL = values.imagenReferenciaURL;
  }
  return payload;
}

function lookup(records, idKey, id) {
  return pick(records.find((item) => String(item[idKey]) === String(id)), ['Nombre'], id || 'Sin identificar');
}

function recordId(config, record, fallback = '') {
  return String(pick(record, config.idKeys, fallback));
}

function upsert(items, config, record) {
  const id = recordId(config, record);
  if (!id) return items;
  const index = items.findIndex((item) => recordId(config, item) === id);
  if (index < 0) return [record, ...items];
  return items.map((item, current) => current === index ? { ...item, ...record } : item);
}

function catalogConfig(tab, data) {
  return {
    categories: { items: data.categories, routes: MODULE_ROUTES.categories, deleteRoutes: DELETE_ROUTES.categories, idKeys: ['CategoriaID', 'id'], idPayload: 'categoriaId', icon: 'category', title: (r) => pick(r, ['Nombre', 'Categoria']), description: (r) => pick(r, ['Descripcion'], 'Categoría de servicio') },
    deviceTypes: { items: data.deviceTypes, routes: MODULE_ROUTES.deviceTypes, deleteRoutes: DELETE_ROUTES.deviceTypes, idKeys: ['TipoDispositivoID', 'id'], idPayload: 'tipoDispositivoId', icon: 'devices', title: (r) => pick(r, ['Nombre', 'TipoDispositivo']), description: (r) => pick(r, ['Descripcion'], 'Tipo de dispositivo') },
    manufacturers: { items: data.manufacturers, routes: MODULE_ROUTES.manufacturers, deleteRoutes: DELETE_ROUTES.manufacturers, idKeys: ['FabricanteID', 'id'], idPayload: 'fabricanteId', icon: 'factory', title: (r) => pick(r, ['Nombre', 'Fabricante']), description: () => 'Fabricante' },
    models: { items: data.models, routes: MODULE_ROUTES.models, deleteRoutes: DELETE_ROUTES.models, idKeys: ['ModeloID', 'id'], idPayload: 'modeloId', icon: 'view_in_ar', title: (r) => pick(r, ['Nombre', 'Modelo']), description: (r) => [lookup(data.deviceTypes, 'TipoDispositivoID', pick(r, ['TipoDispositivoID'])), lookup(data.manufacturers, 'FabricanteID', pick(r, ['FabricanteID'])), pick(r, ['Descripcion'])].filter(Boolean).join(' · ') || 'Modelo' },
    failureTypes: { items: data.failureTypes, routes: MODULE_ROUTES.failureTypes, deleteRoutes: DELETE_ROUTES.failureTypes, idKeys: ['TipoFallaID', 'id'], idPayload: 'tipoFallaId', icon: 'warning', title: (r) => pick(r, ['Nombre', 'TipoFalla']), description: (r) => pick(r, ['Descripcion'], 'Tipo de falla') },
    relations: { items: data.relations, routes: MODULE_ROUTES.deviceManufacturers, deleteRoutes: DELETE_ROUTES.relations, idKeys: ['RelacionID', 'id'], idPayload: 'relacionId', icon: 'account_tree', title: (r) => `${lookup(data.deviceTypes, 'TipoDispositivoID', pick(r, ['TipoDispositivoID']))} → ${lookup(data.manufacturers, 'FabricanteID', pick(r, ['FabricanteID']))}`, description: () => 'Relación dispositivo-fabricante' },
  }[tab];
}

function CatalogFields({ tab, values, setEditor, data }) {
  function change(event) {
    const { name, value } = event.target;
    setEditor((current) => ({ ...current, values: { ...current.values, [name]: value } }));
  }
  if (tab === 'relations') return <><Select label="Tipo de dispositivo" name="tipoDispositivoId" value={values.tipoDispositivoId} onChange={change} records={data.deviceTypes.filter((item) => toBoolean(pick(item, ['Activo'], true), true))} idKeys={['TipoDispositivoID']} labelKeys={['Nombre']} required /><Select label="Fabricante" name="fabricanteId" value={values.fabricanteId} onChange={change} records={data.manufacturers.filter((item) => toBoolean(pick(item, ['Activo'], true), true))} idKeys={['FabricanteID']} labelKeys={['Nombre']} required /></>;
  return <>
    <TextField label="Nombre" name="nombre" value={values.nombre} onChange={change} required />
    {tab !== 'manufacturers' && <TextField label="Descripción" name="descripcion" value={values.descripcion} onChange={change} multiline />}
    {tab === 'models' && <><Select label="Tipo de dispositivo" name="tipoDispositivoId" value={values.tipoDispositivoId} onChange={change} records={data.deviceTypes.filter((item) => toBoolean(pick(item, ['Activo'], true), true))} idKeys={['TipoDispositivoID']} labelKeys={['Nombre']} required /><Select label="Fabricante" name="fabricanteId" value={values.fabricanteId} onChange={change} records={data.manufacturers.filter((item) => toBoolean(pick(item, ['Activo'], true), true))} idKeys={['FabricanteID']} labelKeys={['Nombre']} required /><TextField label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={values.imagenReferenciaURL} onChange={change} /></>}
  </>;
}

export default function CatalogsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canView = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const canManage = hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const [tab, setTab] = useState('categories');
  const [data, setData] = useState(EMPTY_DATA);
  const [loaded, setLoaded] = useState({});
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');

  const loadKeys = useCallback(async (keys, { force = false } = {}) => {
    const unique = [...new Set(keys)].filter((key) => force || !loaded[key]);
    if (!unique.length) return;
    setLoading(true);
    setError('');
    const results = await Promise.allSettled(unique.map((key) => requestAvailable(LIST_ROUTES[key], {
      page: 1,
      pageSize: key === 'models' || key === 'relations' ? 1500 : 750,
      sortBy: 'Nombre',
      sortDir: 'asc',
      includeInactive: canManage,
    }, sessionToken)));
    const next = {};
    const loadedPatch = {};
    const failures = [];
    results.forEach((result, index) => {
      const key = unique[index];
      if (result.status === 'fulfilled') {
        next[key] = normalizeItems(result.value);
        loadedPatch[key] = true;
      } else failures.push(result.reason?.message || key);
    });
    setData((current) => ({ ...current, ...next }));
    setLoaded((current) => ({ ...current, ...loadedPatch }));
    if (failures.length) setError(`No se pudieron cargar algunos catálogos: ${failures.join(' · ')}`);
    setLoading(false);
  }, [canManage, loaded, sessionToken]);

  useEffect(() => {
    if (!canView) return;
    const dependencies = ['models', 'relations'].includes(tab) ? [tab, 'deviceTypes', 'manufacturers'] : [tab];
    loadKeys(dependencies);
  }, [canView, tab, sessionToken, canManage]);

  const activeConfig = useMemo(() => catalogConfig(tab, data), [tab, data]);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeConfig.items;
    return activeConfig.items.filter((record) => `${activeConfig.title(record)} ${activeConfig.description(record)}`.toLowerCase().includes(query));
  }, [activeConfig, search]);

  function switchTab(nextTab) {
    setTab(nextTab);
    setSelected(null);
    setEditor(null);
    setModalError('');
    setSearch('');
  }

  function openCreate() {
    if (!canManage) return;
    setSelected({});
    setEditor({ mode: 'create', record: null, values: emptyValues() });
    setModalError('');
  }

  function openDetail(record) {
    setSelected(record);
    setEditor(null);
    setModalError('');
  }

  function openEdit() {
    if (!canManage || !selected) return;
    setEditor({ mode: 'edit', record: selected, values: valuesFromRecord(tab, selected) });
    setModalError('');
  }

  function closeModal() {
    if (saving) return;
    setSelected(null);
    setEditor(null);
    setModalError('');
  }

  async function toggle() {
    if (!canManage || !selected) return;
    const active = toBoolean(pick(selected, ['Activo', 'activo'], true), true);
    if (!window.confirm(`${active ? 'Desactivar' : 'Reactivar'} “${activeConfig.title(selected)}”?`)) return;
    setSaving(true);
    setModalError('');
    try {
      const response = await requestAvailable(activeConfig.routes.update, { [activeConfig.idPayload]: pick(selected, activeConfig.idKeys), activo: !active, Activo: !active, Estado: active ? 'INACTIVO' : 'ACTIVO' }, sessionToken);
      setSelected(response);
      setData((current) => ({ ...current, [tab]: upsert(current[tab], activeConfig, response) }));
    } catch (toggleError) {
      setModalError(toggleError.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canManage || !selected) return;
    const title = activeConfig.title(selected);
    if (!window.confirm(`¿Eliminar “${title}”? La baja será lógica para conservar registros históricos.`)) return;
    setSaving(true);
    setModalError('');
    try {
      await requestAvailable(activeConfig.deleteRoutes, { [activeConfig.idPayload]: pick(selected, activeConfig.idKeys) }, sessionToken);
      const id = recordId(activeConfig, selected);
      setData((current) => ({ ...current, [tab]: current[tab].filter((item) => recordId(activeConfig, item) !== id) }));
      setSelected(null);
      setEditor(null);
    } catch (removeError) {
      setModalError(removeError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!canManage || !editor) return;
    const values = editor.values;
    if (tab !== 'relations' && !values.nombre.trim()) {
      setModalError('El nombre es obligatorio.');
      return;
    }
    if (tab === 'relations' && (!values.tipoDispositivoId || !values.fabricanteId)) {
      setModalError('Seleccione el tipo de dispositivo y el fabricante.');
      return;
    }
    if (tab === 'models' && (!values.tipoDispositivoId || !values.fabricanteId)) {
      setModalError('Seleccione el tipo de dispositivo y el fabricante.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const basePayload = payloadFromValues(tab, values);
      const response = editor.mode === 'edit'
        ? await requestAvailable(activeConfig.routes.update, { [activeConfig.idPayload]: pick(editor.record, activeConfig.idKeys), ...basePayload }, sessionToken)
        : await requestAvailable(activeConfig.routes.create, { ...basePayload, activo: true, Estado: 'ACTIVO' }, sessionToken);
      setSelected(response);
      setEditor(null);
      setData((current) => ({ ...current, [tab]: upsert(current[tab], activeConfig, response) }));
    } catch (submitError) {
      setModalError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <Navigate to="/mas" replace />;
  const selectedActive = selected ? toBoolean(pick(selected, ['Activo', 'activo'], true), true) : true;
  const tabLabel = TABS.find(([key]) => key === tab)?.[1] || 'Catálogo';

  return <div className="page catalog-page">
    <div className="list-page-heading"><div><span className="eyebrow">Administración</span><h1>Catálogos</h1><p>Valores operativos utilizados por boletas y mantenimientos.</p></div>{canManage && <button className="button button--primary button--compact" type="button" onClick={openCreate}><Icon name="add" />Nuevo</button>}</div>
    <div className="catalog-tabs" role="tablist" aria-label="Tipos de catálogo">{TABS.map(([key, label, icon]) => <button key={key} className={tab === key ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === key} onClick={() => switchTab(key)}><Icon name={icon} /><span>{label}</span></button>)}</div>
    {!canManage && <div className="readonly-notice"><Icon name="visibility" /><span>Modo consulta: puede revisar los catálogos, pero no modificarlos.</span></div>}
    <label className="search-bar"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar en ${tabLabel.toLowerCase()}...`} /><button className="icon-button" type="button" onClick={() => loadKeys([tab], { force: true })} aria-label="Actualizar"><Icon name="refresh" /></button></label>
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
    {loading && !loaded[tab] ? <div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando {tabLabel.toLowerCase()}...</div> : <div className="admin-mini-card-grid">
      {visibleItems.map((record, index) => {
        const active = toBoolean(pick(record, ['Activo', 'activo'], true), true);
        return <article className={`admin-mini-card${active ? '' : ' is-inactive'}`} key={pick(record, activeConfig.idKeys, index)}><span className="admin-mini-card__icon"><Icon name={activeConfig.icon} /></span><div className="admin-mini-card__body"><strong>{activeConfig.title(record)}</strong><span>{activeConfig.description(record)}</span><small>{active ? 'ACTIVO' : 'INACTIVO'}</small></div><button className="icon-button icon-button--outlined admin-mini-card__action" type="button" onClick={() => openDetail(record)} aria-label={`${canManage ? 'Administrar' : 'Ver'} ${activeConfig.title(record)}`}><Icon name={canManage ? 'edit' : 'visibility'} /></button></article>;
      })}
      {!visibleItems.length && <div className="empty-state"><Icon name="inventory_2" /><h2>Sin registros</h2><p>No hay resultados en este catálogo.</p></div>}
    </div>}

    <AdminEntityModal open={Boolean(selected)} title={editor ? (editor.mode === 'edit' ? `Editar ${tabLabel}` : `Nuevo: ${tabLabel}`) : (selected && Object.keys(selected).length ? activeConfig.title(selected) : `Nuevo: ${tabLabel}`)} subtitle={editor ? 'Complete la información del registro.' : (selected && Object.keys(selected).length ? activeConfig.description(selected) : 'Complete la información del registro.')} eyebrow={editor ? 'Edición de catálogo' : 'Detalle de catálogo'} icon={activeConfig.icon} onClose={closeModal} busy={saving} footer={!editor && selected && Object.keys(selected).length && canManage ? <><button className="button button--danger" type="button" onClick={remove} disabled={saving}><Icon name="delete" />Eliminar</button><button className="button button--secondary" type="button" onClick={toggle} disabled={saving}><Icon name={selectedActive ? 'block' : 'refresh'} />{selectedActive ? 'Desactivar' : 'Reactivar'}</button><button className="button button--primary" type="button" onClick={openEdit} disabled={saving}><Icon name="edit" />Editar</button></> : null}>
      {modalError && <div className="alert alert--error"><Icon name="error" /><span>{modalError}</span></div>}
      {editor ? <form className="stack-form" onSubmit={submit}><CatalogFields tab={tab} values={editor.values} setEditor={setEditor} data={data} /><div className="form-actions"><button className="button button--secondary" type="button" onClick={() => editor.mode === 'create' ? closeModal() : setEditor(null)} disabled={saving}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></div></form> : selected && Object.keys(selected).length ? <div className="admin-detail-grid"><div><span>Estado</span><strong>{selectedActive ? 'ACTIVO' : 'INACTIVO'}</strong></div><div><span>Tipo de catálogo</span><strong>{tabLabel}</strong></div><div className="is-wide"><span>Descripción</span><strong>{activeConfig.description(selected)}</strong></div>{tab === 'models' && <><div><span>Tipo de dispositivo</span><strong>{lookup(data.deviceTypes, 'TipoDispositivoID', pick(selected, ['TipoDispositivoID']))}</strong></div><div><span>Fabricante</span><strong>{lookup(data.manufacturers, 'FabricanteID', pick(selected, ['FabricanteID']))}</strong></div></>}</div> : null}
    </AdminEntityModal>
  </div>;
}
