import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

function ErrorMessage({ message }) {
  return message ? <p role="alert">Error: {message}</p> : null;
}

function CatalogLayout() {
  const { hasPermission } = useAuth();
  if (!hasPermission('CATALOGOS_GESTIONAR')) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <header>
        <strong>Catálogos</strong>{' | '}
        <Link to="/">Home</Link>{' | '}
        <Link to="/catalogos/categorias">Categorías</Link>{' | '}
        <Link to="/catalogos/dispositivos">Dispositivos</Link>{' | '}
        <Link to="/catalogos/fabricantes">Fabricantes</Link>{' | '}
        <Link to="/catalogos/modelos">Modelos</Link>{' | '}
        <Link to="/catalogos/tipos-falla">Tipos de falla</Link>{' | '}
        <Link to="/catalogos/relaciones">Relaciones</Link>
      </header>
      <hr />
      <Routes>
        <Route path="/catalogos" element={<Navigate to="/catalogos/categorias" replace />} />
        <Route path="/catalogos/categorias" element={<SimpleCatalogPage config={CATALOGS.categories} />} />
        <Route path="/catalogos/dispositivos" element={<SimpleCatalogPage config={CATALOGS.deviceTypes} />} />
        <Route path="/catalogos/fabricantes" element={<SimpleCatalogPage config={CATALOGS.manufacturers} />} />
        <Route path="/catalogos/tipos-falla" element={<SimpleCatalogPage config={CATALOGS.failureTypes} />} />
        <Route path="/catalogos/modelos" element={<ModelsPage />} />
        <Route path="/catalogos/relaciones" element={<RelationsPage />} />
        <Route path="*" element={<Navigate to="/catalogos/categorias" replace />} />
      </Routes>
    </>
  );
}

const CATALOGS = {
  categories: { title: 'Categorías', routePrefix: 'catalog.categories', idKey: 'CategoriaID', idPayload: 'categoriaId', description: true },
  deviceTypes: { title: 'Tipos de dispositivo', routePrefix: 'catalog.deviceTypes', idKey: 'TipoDispositivoID', idPayload: 'tipoDispositivoId', description: true },
  manufacturers: { title: 'Fabricantes', routePrefix: 'catalog.manufacturers', idKey: 'FabricanteID', idPayload: 'fabricanteId', description: false },
  failureTypes: { title: 'Tipos de falla', routePrefix: 'catalog.failureTypes', idKey: 'TipoFallaID', idPayload: 'tipoFallaId', description: true },
};

function SimpleCatalogPage({ config }) {
  const { sessionToken } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ id: '', nombre: '', descripcion: '', activo: true });
  const [error, setError] = useState('');

  async function load() {
    try {
      const result = await apiRequest(`${config.routePrefix}.list`, { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setItems(result.items || []);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [config.routePrefix, sessionToken]);

  async function submit(event) {
    event.preventDefault();
    try {
      const payload = { nombre: form.nombre, descripcion: form.descripcion, activo: form.activo };
      if (form.id) payload[config.idPayload] = form.id;
      await apiRequest(`${config.routePrefix}.${form.id ? 'update' : 'create'}`, payload, sessionToken);
      setForm({ id: '', nombre: '', descripcion: '', activo: true });
      await load();
    } catch (err) { setError(err.message); }
  }

  async function deactivate(item) {
    if (!window.confirm(`¿Desactivar ${item.Nombre}?`)) return;
    try {
      await apiRequest(`${config.routePrefix}.update`, { [config.idPayload]: item[config.idKey], activo: false }, sessionToken);
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <main>
      <h1>{config.title}</h1>
      <ErrorMessage message={error} />
      <form onSubmit={submit}>
        <div><label>Nombre<br /><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label></div>
        {config.description && <div><label>Descripción<br /><textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></label></div>}
        <label><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
        <p><button>{form.id ? 'Actualizar' : 'Agregar'}</button>{' '}{form.id && <button type="button" onClick={() => setForm({ id: '', nombre: '', descripcion: '', activo: true })}>Cancelar</button>}</p>
      </form>
      <table border="1" cellPadding="5">
        <thead><tr><th>Nombre</th>{config.description && <th>Descripción</th>}<th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item[config.idKey]}><td>{item.Nombre}</td>{config.description && <td>{item.Descripcion}</td>}<td>{item.Activo ? 'ACTIVO' : 'INACTIVO'}</td><td><button type="button" onClick={() => setForm({ id: item[config.idKey], nombre: item.Nombre || '', descripcion: item.Descripcion || '', activo: Boolean(item.Activo) })}>Editar</button>{' '}{item.Activo && <button type="button" onClick={() => deactivate(item)}>Eliminar</button>}</td></tr>)}</tbody>
      </table>
    </main>
  );
}

function useCatalogData() {
  const { sessionToken } = useAuth();
  const [data, setData] = useState({ devices: [], manufacturers: [], models: [], relations: [] });
  const [error, setError] = useState('');
  async function load() {
    try {
      const [devices, manufacturers, models, relations] = await Promise.all([
        apiRequest('catalog.deviceTypes.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        apiRequest('catalog.manufacturers.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        apiRequest('catalog.models.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
        apiRequest('catalog.deviceManufacturers.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      ]);
      setData({ devices: devices.items || [], manufacturers: manufacturers.items || [], models: models.items || [], relations: relations.items || [] });
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [sessionToken]);
  return { ...data, error, load };
}

function ModelsPage() {
  const { sessionToken } = useAuth();
  const catalogs = useCatalogData();
  const [form, setForm] = useState({ modeloId: '', tipoDispositivoId: '', fabricanteId: '', nombre: '', descripcion: '', imagenReferenciaURL: '', activo: true });
  const [error, setError] = useState('');
  const allowedManufacturers = useMemo(() => {
    if (!form.tipoDispositivoId) return catalogs.manufacturers;
    const ids = new Set(catalogs.relations.filter((r) => r.TipoDispositivoID === form.tipoDispositivoId).map((r) => r.FabricanteID));
    return catalogs.manufacturers.filter((m) => ids.has(m.FabricanteID));
  }, [catalogs.manufacturers, catalogs.relations, form.tipoDispositivoId]);
  async function submit(event) {
    event.preventDefault();
    try {
      await apiRequest(`catalog.models.${form.modeloId ? 'update' : 'create'}`, form, sessionToken);
      setForm({ modeloId: '', tipoDispositivoId: '', fabricanteId: '', nombre: '', descripcion: '', imagenReferenciaURL: '', activo: true });
      await catalogs.load();
    } catch (err) { setError(err.message); }
  }
  const deviceName = Object.fromEntries(catalogs.devices.map((x) => [x.TipoDispositivoID, x.Nombre]));
  const manufacturerName = Object.fromEntries(catalogs.manufacturers.map((x) => [x.FabricanteID, x.Nombre]));
  return <main><h1>Modelos</h1><p>Primero ligue el dispositivo con el fabricante.</p><ErrorMessage message={catalogs.error || error} /><form onSubmit={submit}><div><label>Dispositivo<br /><select value={form.tipoDispositivoId} onChange={(e) => setForm({ ...form, tipoDispositivoId: e.target.value, fabricanteId: '' })} required><option value="">Seleccione</option>{catalogs.devices.filter((x) => x.Activo).map((x) => <option key={x.TipoDispositivoID} value={x.TipoDispositivoID}>{x.Nombre}</option>)}</select></label></div><div><label>Fabricante<br /><select value={form.fabricanteId} onChange={(e) => setForm({ ...form, fabricanteId: e.target.value })} required><option value="">Seleccione</option>{allowedManufacturers.filter((x) => x.Activo).map((x) => <option key={x.FabricanteID} value={x.FabricanteID}>{x.Nombre}</option>)}</select></label></div><div><label>Modelo<br /><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label></div><div><label>Descripción<br /><textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></label></div><div><label>URL imagen<br /><input value={form.imagenReferenciaURL} onChange={(e) => setForm({ ...form, imagenReferenciaURL: e.target.value })} /></label></div><label><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo</label><p><button>{form.modeloId ? 'Actualizar' : 'Agregar modelo'}</button></p></form><table border="1" cellPadding="5"><thead><tr><th>Dispositivo</th><th>Fabricante</th><th>Modelo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{catalogs.models.map((m) => <tr key={m.ModeloID}><td>{deviceName[m.TipoDispositivoID]}</td><td>{manufacturerName[m.FabricanteID]}</td><td>{m.Nombre}</td><td>{m.Activo ? 'ACTIVO' : 'INACTIVO'}</td><td><button type="button" onClick={() => setForm({ modeloId: m.ModeloID, tipoDispositivoId: m.TipoDispositivoID, fabricanteId: m.FabricanteID, nombre: m.Nombre || '', descripcion: m.Descripcion || '', imagenReferenciaURL: m.ImagenReferenciaURL || '', activo: Boolean(m.Activo) })}>Editar</button></td></tr>)}</tbody></table></main>;
}

function RelationsPage() {
  const { sessionToken } = useAuth();
  const catalogs = useCatalogData();
  const [deviceId, setDeviceId] = useState('');
  const [manufacturerId, setManufacturerId] = useState('');
  const [error, setError] = useState('');
  async function add(event) { event.preventDefault(); try { await apiRequest('catalog.deviceManufacturers.create', { tipoDispositivoId: deviceId, fabricanteId: manufacturerId }, sessionToken); setManufacturerId(''); await catalogs.load(); } catch (err) { setError(err.message); } }
  async function remove(relation) { if (!window.confirm('¿Eliminar esta relación?')) return; try { await apiRequest('catalog.deviceManufacturers.update', { relacionId: relation.RelacionID, activo: false }, sessionToken); await catalogs.load(); } catch (err) { setError(err.message); } }
  const deviceName = Object.fromEntries(catalogs.devices.map((x) => [x.TipoDispositivoID, x.Nombre]));
  const manufacturerName = Object.fromEntries(catalogs.manufacturers.map((x) => [x.FabricanteID, x.Nombre]));
  return <main><h1>Relaciones dispositivo y fabricante</h1><p>Ejemplo: Cámara → Axis. Después podrá crear el modelo 12312 dentro de esa relación.</p><ErrorMessage message={catalogs.error || error} /><form onSubmit={add}><label>Dispositivo<br /><select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required><option value="">Seleccione</option>{catalogs.devices.filter((x) => x.Activo).map((x) => <option key={x.TipoDispositivoID} value={x.TipoDispositivoID}>{x.Nombre}</option>)}</select></label><br /><label>Fabricante<br /><select value={manufacturerId} onChange={(e) => setManufacturerId(e.target.value)} required><option value="">Seleccione</option>{catalogs.manufacturers.filter((x) => x.Activo).map((x) => <option key={x.FabricanteID} value={x.FabricanteID}>{x.Nombre}</option>)}</select></label><p><button>Agregar relación</button></p></form><table border="1" cellPadding="5"><thead><tr><th>Dispositivo</th><th>Fabricante</th><th>Acción</th></tr></thead><tbody>{catalogs.relations.map((r) => <tr key={r.RelacionID}><td>{deviceName[r.TipoDispositivoID]}</td><td>{manufacturerName[r.FabricanteID]}</td><td><button type="button" onClick={() => remove(r)}>Eliminar relación</button></td></tr>)}</tbody></table></main>;
}

export default function CatalogosApp() { return <CatalogLayout />; }
