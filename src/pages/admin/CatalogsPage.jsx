import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import InlineCreateModal from '../../components/forms/InlineCreateModal';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable, toBoolean } from '../../services/moduleApi';

const TABS = [
  ['categories', 'Categorías', 'category'],
  ['deviceTypes', 'Dispositivos', 'devices'],
  ['manufacturers', 'Fabricantes', 'factory'],
  ['models', 'Modelos', 'view_in_ar'],
  ['failureTypes', 'Tipos de falla', 'warning'],
  ['relations', 'Relaciones', 'account_tree'],
];

function TextField({ label, multiline = false, ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {multiline ? <textarea className="form-control ticket-textarea" rows="4" {...props} /> : <input className="form-control" {...props} />}
    </label>
  );
}

export default function CatalogsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const canView = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR');
  const canManage = hasPermission('USUARIOS_GESTIONAR') && hasPermission('CATALOGOS_GESTIONAR');
  const [tab, setTab] = useState('categories');
  const [data, setData] = useState({ categories: [], deviceTypes: [], manufacturers: [], models: [], failureTypes: [], relations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const requests = [
      ['categories', MODULE_ROUTES.categories.list],
      ['deviceTypes', MODULE_ROUTES.deviceTypes.list],
      ['manufacturers', MODULE_ROUTES.manufacturers.list],
      ['models', MODULE_ROUTES.models.list],
      ['failureTypes', MODULE_ROUTES.failureTypes.list],
      ['relations', MODULE_ROUTES.deviceManufacturers.list],
    ];
    const results = await Promise.allSettled(
      requests.map(([, routes]) => requestAvailable(routes, { page: 1, pageSize: 1000, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken)),
    );
    const next = {};
    const failures = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[requests[index][0]] = normalizeItems(result.value);
      else failures.push(result.reason?.message || requests[index][0]);
    });
    setData((current) => ({ ...current, ...next }));
    if (failures.length) setError(`No se pudieron cargar algunos catálogos: ${failures.join(' · ')}`);
    setLoading(false);
  }

  useEffect(() => { if (canView) load(); }, [sessionToken, canView]);
  const activeConfig = useMemo(() => catalogConfig(tab, data), [tab, data]);

  async function toggle(record) {
    if (!canManage) return;
    const active = toBoolean(pick(record, ['Activo', 'activo'], true), true);
    if (!window.confirm(`${active ? 'Desactivar' : 'Reactivar'} este registro?`)) return;
    setSaving(true);
    try {
      await requestAvailable(
        activeConfig.routes.update,
        { [activeConfig.idPayload]: pick(record, activeConfig.idKeys), activo: !active },
        sessionToken,
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    if (!canManage) {
      setError('Solo los administradores pueden crear registros en Catálogos.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const values = modal.values;
      let createPayload = { nombre: values.nombre, descripcion: values.descripcion, activo: true };
      if (tab === 'models') {
        createPayload = {
          ...createPayload,
          tipoDispositivoId: values.tipoDispositivoId,
          fabricanteId: values.fabricanteId,
          imagenReferenciaURL: values.imagenReferenciaURL,
        };
      }
      if (tab === 'relations') {
        createPayload = { tipoDispositivoId: values.tipoDispositivoId, fabricanteId: values.fabricanteId, activo: true };
      }
      await requestAvailable(activeConfig.routes.create, createPayload, sessionToken);
      setModal(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <Navigate to="/mas" replace />;

  return (
    <div className="page catalog-page">
      <div className="list-page-heading">
        <div><span className="eyebrow">Administración</span><h1>Catálogos</h1><p>Valores operativos utilizados por las boletas.</p></div>
        {canManage && (
          <button
            className="button button--primary button--compact"
            type="button"
            onClick={() => setModal({ values: { nombre: '', descripcion: '', tipoDispositivoId: '', fabricanteId: '', imagenReferenciaURL: '' } })}
          >
            <Icon name="add" /> Nuevo
          </button>
        )}
      </div>

      <div className="catalog-tabs" role="tablist">
        {TABS.map(([key, label, icon]) => (
          <button key={key} className={tab === key ? 'is-active' : ''} type="button" onClick={() => setTab(key)}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </div>

      {!canManage && (
        <div className="readonly-notice">
          <Icon name="visibility" />
          <span>Modo consulta: los técnicos pueden revisar los catálogos, pero solo un administrador puede agregar, desactivar o reactivar registros.</span>
        </div>
      )}

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

      {loading ? (
        <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando catálogos...</div>
      ) : (
        <div className="catalog-record-grid">
          {activeConfig.items.length ? activeConfig.items.map((record, index) => {
            const active = toBoolean(pick(record, ['Activo', 'activo'], true), true);
            return (
              <article className={`catalog-record${active ? '' : ' is-inactive'}`} key={pick(record, activeConfig.idKeys, index)}>
                <span className="catalog-record__icon"><Icon name={activeConfig.icon} /></span>
                <div><h3>{activeConfig.title(record)}</h3><p>{activeConfig.description(record)}</p></div>
                <span className={`status-chip ${active ? 'status-chip--active' : 'status-chip--inactive'}`}>{active ? 'ACTIVO' : 'INACTIVO'}</span>
                {canManage && (
                  <button className="button button--secondary button--compact" type="button" onClick={() => toggle(record)} disabled={saving}>
                    {active ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </article>
            );
          }) : (
            <div className="empty-state"><Icon name="inventory_2" /><h2>Sin registros</h2><p>El backend no devolvió valores para este catálogo.</p></div>
          )}
        </div>
      )}

      {canManage && (
        <InlineCreateModal
          open={Boolean(modal)}
          title={`Nuevo registro: ${TABS.find(([key]) => key === tab)?.[1]}`}
          saving={saving}
          error={error}
          onClose={() => setModal(null)}
          onSubmit={create}
        >
          {modal && <CatalogCreateFields tab={tab} values={modal.values} setModal={setModal} data={data} />}
        </InlineCreateModal>
      )}
    </div>
  );
}

function CatalogCreateFields({ tab, values, setModal, data }) {
  function change(event) {
    const { name, value } = event.target;
    setModal((current) => ({ ...current, values: { ...current.values, [name]: value } }));
  }

  if (tab === 'relations') {
    return (
      <>
        <Select label="Tipo de dispositivo" name="tipoDispositivoId" value={values.tipoDispositivoId} onChange={change} records={data.deviceTypes} idKeys={['TipoDispositivoID']} labelKeys={['Nombre']} required />
        <Select label="Fabricante" name="fabricanteId" value={values.fabricanteId} onChange={change} records={data.manufacturers} idKeys={['FabricanteID']} labelKeys={['Nombre']} required />
      </>
    );
  }

  return (
    <>
      <TextField label="Nombre" name="nombre" value={values.nombre} onChange={change} required />
      {tab !== 'manufacturers' && <TextField label="Descripción" name="descripcion" value={values.descripcion} onChange={change} multiline />}
      {tab === 'models' && (
        <>
          <Select label="Tipo de dispositivo" name="tipoDispositivoId" value={values.tipoDispositivoId} onChange={change} records={data.deviceTypes} idKeys={['TipoDispositivoID']} labelKeys={['Nombre']} required />
          <Select label="Fabricante" name="fabricanteId" value={values.fabricanteId} onChange={change} records={data.manufacturers} idKeys={['FabricanteID']} labelKeys={['Nombre']} required />
          <TextField label="Imagen de referencia (URL)" name="imagenReferenciaURL" value={values.imagenReferenciaURL} onChange={change} />
        </>
      )}
    </>
  );
}

function Select({ label, records, idKeys, labelKeys, ...props }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" {...props}>
        <option value="">Seleccione</option>
        {records.map((record) => <option key={pick(record, idKeys)} value={pick(record, idKeys)}>{pick(record, labelKeys)}</option>)}
      </select>
    </label>
  );
}

function lookup(records, idKey, id) {
  return pick(records.find((item) => String(item[idKey]) === String(id)), ['Nombre'], id || 'Sin identificar');
}

function catalogConfig(tab, data) {
  return {
    categories: { items: data.categories, routes: MODULE_ROUTES.categories, idKeys: ['CategoriaID', 'id'], idPayload: 'categoriaId', icon: 'category', title: (r) => pick(r, ['Nombre', 'Categoria']), description: (r) => pick(r, ['Descripcion'], 'Categoría de servicio') },
    deviceTypes: { items: data.deviceTypes, routes: MODULE_ROUTES.deviceTypes, idKeys: ['TipoDispositivoID', 'id'], idPayload: 'tipoDispositivoId', icon: 'devices', title: (r) => pick(r, ['Nombre', 'TipoDispositivo']), description: (r) => pick(r, ['Descripcion'], 'Tipo de dispositivo') },
    manufacturers: { items: data.manufacturers, routes: MODULE_ROUTES.manufacturers, idKeys: ['FabricanteID', 'id'], idPayload: 'fabricanteId', icon: 'factory', title: (r) => pick(r, ['Nombre', 'Fabricante']), description: () => 'Fabricante' },
    models: { items: data.models, routes: MODULE_ROUTES.models, idKeys: ['ModeloID', 'id'], idPayload: 'modeloId', icon: 'view_in_ar', title: (r) => pick(r, ['Nombre', 'Modelo']), description: (r) => [pick(r, ['TipoDispositivo']), pick(r, ['Fabricante']), pick(r, ['Descripcion'])].filter(Boolean).join(' · ') || 'Modelo' },
    failureTypes: { items: data.failureTypes, routes: MODULE_ROUTES.failureTypes, idKeys: ['TipoFallaID', 'id'], idPayload: 'tipoFallaId', icon: 'warning', title: (r) => pick(r, ['Nombre', 'TipoFalla']), description: (r) => pick(r, ['Descripcion'], 'Tipo de falla') },
    relations: { items: data.relations, routes: MODULE_ROUTES.deviceManufacturers, idKeys: ['RelacionID', 'id'], idPayload: 'relacionId', icon: 'account_tree', title: (r) => `${lookup(data.deviceTypes, 'TipoDispositivoID', pick(r, ['TipoDispositivoID']))} → ${lookup(data.manufacturers, 'FabricanteID', pick(r, ['FabricanteID']))}`, description: () => 'Relación dispositivo-fabricante' },
  }[tab];
}
