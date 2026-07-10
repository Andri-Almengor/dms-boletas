import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

function ErrorMessage({ message }) {
  return message ? <p role="alert">Error: {message}</p> : null;
}

function Loading() {
  return <p>Cargando...</p>;
}

function useCatalogs() {
  const { sessionToken } = useAuth();
  const [data, setData] = useState({
    clients: [], users: [], categories: [], deviceTypes: [], manufacturers: [], models: [],
  });
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest('clients.list', { page: 1, pageSize: 200, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
      apiRequest('users.list', { page: 1, pageSize: 200, sortBy: 'NombreCompleto', sortDir: 'asc' }, sessionToken),
      apiRequest('catalog.categories.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.deviceTypes.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.manufacturers.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.models.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
    ]).then(([clients, users, categories, deviceTypes, manufacturers, models]) => {
      if (!active) return;
      setData({
        clients: clients.items || [],
        users: (users.items || []).filter((u) => u.Estado === 'ACTIVO'),
        categories: categories.items || [],
        deviceTypes: deviceTypes.items || [],
        manufacturers: manufacturers.items || [],
        models: models.items || [],
      });
    }).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [sessionToken]);

  return { ...data, error };
}

function BoletasLayout() {
  const { hasPermission } = useAuth();
  if (!hasPermission('BOLETAS_VER')) return <Navigate to="/" replace />;

  return (
    <>
      <header>
        <strong>Boletas</strong>{' | '}
        <Link to="/">Home</Link>{' | '}
        <Link to="/boletas/pendientes">Pendientes</Link>{' | '}
        <Link to="/boletas/finalizadas">Finalizadas</Link>
        {hasPermission('BOLETAS_CREAR') && <>{' | '}<Link to="/boletas/nueva">Crear boleta</Link></>}
      </header>
      <hr />
      <Routes>
        <Route index element={<Navigate to="pendientes" replace />} />
        <Route path="pendientes" element={<BoletasList estado="PENDIENTE" />} />
        <Route path="finalizadas" element={<BoletasList estado="FINALIZADO" />} />
        <Route path="nueva" element={<BoletaForm mode="create" />} />
        <Route path=":boletaUid" element={<BoletaDetail />} />
        <Route path=":boletaUid/editar" element={<BoletaForm mode="edit" />} />
        <Route path="*" element={<Navigate to="pendientes" replace />} />
      </Routes>
    </>
  );
}

function BoletasList({ estado }) {
  const { sessionToken, user, hasPermission } = useAuth();
  const catalogs = useCatalogs();
  const isAdmin = hasPermission('BOLETAS_ELIMINAR');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '', clienteId: '', dateFrom: '', dateTo: '', asignadoUsuarioId: '',
    categoriaId: '', tipoDispositivoId: '', fabricanteId: '', modeloId: '',
  });

  const filteredModels = useMemo(() => catalogs.models.filter((m) =>
    (!filters.tipoDispositivoId || m.TipoDispositivoID === filters.tipoDispositivoId) &&
    (!filters.fabricanteId || m.FabricanteID === filters.fabricanteId)
  ), [catalogs.models, filters.tipoDispositivoId, filters.fabricanteId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = {
        page: 1, pageSize: 200, estado, sortBy: 'Fecha', sortDir: 'desc',
        search: filters.search,
        clienteId: filters.clienteId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        categoriaId: filters.categoriaId,
        tipoDispositivoId: filters.tipoDispositivoId,
        asignadoUsuarioId: isAdmin ? filters.asignadoUsuarioId : user.UsuarioID,
      };
      const result = await apiRequest('boletas.list', payload, sessionToken);
      let rows = result.items || [];
      if (filters.fabricanteId) rows = rows.filter((r) => r.FabricanteID === filters.fabricanteId);
      if (filters.modeloId) rows = rows.filter((r) => r.ModeloID === filters.modeloId);
      setItems(rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [estado, sessionToken]);

  function field(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function remove(boleta) {
    if (!isAdmin || !window.confirm(`¿Anular la boleta ${boleta.BoletaID}?`)) return;
    try {
      await apiRequest('boletas.cancel', { boletaUid: boleta.BoletaUID }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <h1>Boletas {estado === 'FINALIZADO' ? 'finalizadas' : 'pendientes'}</h1>
      <form onSubmit={(e) => { e.preventDefault(); load(); }}>
        <div><label>Buscar por título, dispositivo, fabricante o modelo<br /><input name="search" value={filters.search} onChange={field} /></label></div>
        <div><label>Cliente<br /><select name="clienteId" value={filters.clienteId} onChange={field}><option value="">Todos</option>{catalogs.clients.map((c) => <option key={c.ClienteID} value={c.ClienteID}>{c.Nombre}</option>)}</select></label></div>
        <div><label>Desde<br /><input type="date" name="dateFrom" value={filters.dateFrom} onChange={field} /></label></div>
        <div><label>Hasta<br /><input type="date" name="dateTo" value={filters.dateTo} onChange={field} /></label></div>
        {isAdmin && <div><label>Técnico<br /><select name="asignadoUsuarioId" value={filters.asignadoUsuarioId} onChange={field}><option value="">Todos</option>{catalogs.users.map((u) => <option key={u.UsuarioID} value={u.UsuarioID}>{u.NombreCompleto}</option>)}</select></label></div>}
        <div><label>Categoría<br /><select name="categoriaId" value={filters.categoriaId} onChange={field}><option value="">Todas</option>{catalogs.categories.map((x) => <option key={x.CategoriaID} value={x.CategoriaID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Tipo de dispositivo<br /><select name="tipoDispositivoId" value={filters.tipoDispositivoId} onChange={field}><option value="">Todos</option>{catalogs.deviceTypes.map((x) => <option key={x.TipoDispositivoID} value={x.TipoDispositivoID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Fabricante<br /><select name="fabricanteId" value={filters.fabricanteId} onChange={field}><option value="">Todos</option>{catalogs.manufacturers.map((x) => <option key={x.FabricanteID} value={x.FabricanteID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Modelo<br /><select name="modeloId" value={filters.modeloId} onChange={field}><option value="">Todos</option>{filteredModels.map((x) => <option key={x.ModeloID} value={x.ModeloID}>{x.Nombre}</option>)}</select></label></div>
        <button>Filtrar</button>{' '}<button type="button" onClick={() => setFilters({ search: '', clienteId: '', dateFrom: '', dateTo: '', asignadoUsuarioId: '', categoriaId: '', tipoDispositivoId: '', fabricanteId: '', modeloId: '' })}>Limpiar</button>
      </form>
      <ErrorMessage message={catalogs.error || error} />
      {loading ? <Loading /> : items.length === 0 ? <p>No hay boletas.</p> : (
        <table border="1" cellPadding="5">
          <thead><tr><th>Fecha</th><th>Boleta</th><th>Título</th><th>Cliente</th><th>Asignados</th><th>Categoría</th><th>Dispositivo</th><th>Acciones</th></tr></thead>
          <tbody>{items.map((b) => <tr key={b.BoletaUID}>
            <td>{b.Fecha ? new Date(b.Fecha).toLocaleDateString() : ''}</td>
            <td>{b.BoletaID}</td>
            <td>{b.Titulo}</td>
            <td>{b.Cliente}</td>
            <td>{(b.asignados || []).map((u) => u.NombreCompleto).join(', ')}</td>
            <td>{b.Categoria}</td>
            <td>{[b.TipoDispositivo, b.Fabricante, b.Modelo].filter(Boolean).join(' - ')}</td>
            <td><Link to={`/boletas/${b.BoletaUID}`}>Ver</Link>{hasPermission('BOLETAS_EDITAR') && <>{' | '}<Link to={`/boletas/${b.BoletaUID}/editar`}>Editar</Link></>}{isAdmin && <>{' | '}<button type="button" onClick={() => remove(b)}>Eliminar</button></>}</td>
          </tr>)}</tbody>
        </table>
      )}
    </main>
  );
}

const EMPTY_FORM = {
  titulo: '', estado: 'PENDIENTE', fecha: new Date().toISOString().slice(0, 10),
  horaInicio: '', horaFinal: '', horasTotales: 0, clienteId: '', ubicacionId: '',
  ubicacionEquipoId: '', supervisorId: '', correoCliente: '', correoSupervisor: '',
  categoriaId: '', tipoDispositivoId: '', dispositivoId: '', fabricanteId: '', modeloId: '',
  serie: '', razonVisita: '', descripcion: '', pruebasRealizadas: '', resultado: '',
  recomendaciones: '', tipoFalla: '', asignados: [], enviarCorreoCliente: false, correosCC: '',
};

function BoletaForm({ mode }) {
  const { boletaUid } = useParams();
  const { sessionToken, user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const catalogs = useCatalogs();
  const [form, setForm] = useState(EMPTY_FORM);
  const [locations, setLocations] = useState([]);
  const [equipmentLocations, setEquipmentLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit') {
      setForm((current) => ({ ...current, asignados: [user.UsuarioID] }));
      return;
    }
    apiRequest('boletas.get', { boletaUid }, sessionToken).then((data) => {
      const b = data.boleta;
      setForm({
        titulo: b.Titulo || '', estado: b.Estado || 'PENDIENTE', fecha: b.Fecha ? new Date(b.Fecha).toISOString().slice(0, 10) : '',
        horaInicio: b.HoraInicio || '', horaFinal: b.HoraFinal || '', horasTotales: b.HorasTotales || 0,
        clienteId: b.ClienteID || '', ubicacionId: b.UbicacionID || '', ubicacionEquipoId: b.UbicacionEquipoID || '',
        supervisorId: b.SupervisorID || '', correoCliente: b.CorreoCliente || '', correoSupervisor: b.CorreoSupervisor || '',
        categoriaId: b.CategoriaID || '', tipoDispositivoId: b.TipoDispositivoID || '', dispositivoId: b.DispositivoID || '',
        fabricanteId: b.FabricanteID || '', modeloId: b.ModeloID || '', serie: b.Serie || '', razonVisita: b.RazonVisita || '',
        descripcion: b.Descripcion || '', pruebasRealizadas: b.PruebasRealizadas || '', resultado: b.Resultado || '',
        recomendaciones: b.Recomendaciones || '', tipoFalla: b.TipoFalla || '',
        asignados: (data.asignados || []).map((x) => x.UsuarioID), enviarCorreoCliente: Boolean(b.EnviarCorreoCliente), correosCC: b.CorreosCC || '',
      });
    }).catch((err) => setError(err.message));
  }, [mode, boletaUid, sessionToken, user.UsuarioID]);

  useEffect(() => {
    if (!form.clienteId) { setLocations([]); setContacts([]); return; }
    Promise.all([
      apiRequest('clientLocations.list', { clienteId: form.clienteId, activo: true, pageSize: 200 }, sessionToken),
      apiRequest('contacts.list', { clienteId: form.clienteId, activo: true, pageSize: 200 }, sessionToken),
    ]).then(([l, c]) => { setLocations(l.items || []); setContacts(c.items || []); }).catch((err) => setError(err.message));
  }, [form.clienteId, sessionToken]);

  useEffect(() => {
    if (!form.ubicacionId) { setEquipmentLocations([]); return; }
    apiRequest('equipmentLocations.list', { ubicacionId: form.ubicacionId, activo: true, pageSize: 200 }, sessionToken)
      .then((x) => setEquipmentLocations(x.items || [])).catch((err) => setError(err.message));
  }, [form.ubicacionId, sessionToken]);

  const filteredModels = catalogs.models.filter((m) =>
    (!form.tipoDispositivoId || m.TipoDispositivoID === form.tipoDispositivoId) &&
    (!form.fabricanteId || m.FabricanteID === form.fabricanteId)
  );

  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  function changeAssigned(event) {
    setForm((current) => ({ ...current, asignados: Array.from(event.target.selectedOptions).map((o) => o.value) }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      if (mode === 'create') {
        const result = await apiRequest('boletas.create', form, sessionToken);
        navigate(`/boletas/${result.boleta.BoletaUID}`);
      } else {
        await apiRequest('boletas.update', { boletaUid, ...form }, sessionToken);
        navigate(`/boletas/${boletaUid}`);
      }
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  if (mode === 'create' && !hasPermission('BOLETAS_CREAR')) return <Navigate to="/boletas/pendientes" replace />;
  if (mode === 'edit' && !hasPermission('BOLETAS_EDITAR')) return <Navigate to={`/boletas/${boletaUid}`} replace />;

  return (
    <main>
      <h1>{mode === 'create' ? 'Crear boleta' : 'Editar boleta'}</h1>
      <ErrorMessage message={catalogs.error || error} />
      <form onSubmit={save}>
        <div><label>Título<br /><input name="titulo" value={form.titulo} onChange={change} required /></label></div>
        <div><label>Estado<br /><select name="estado" value={form.estado} onChange={change}><option value="BORRADOR">BORRADOR</option><option value="PENDIENTE">PENDIENTE</option><option value="FINALIZADO">FINALIZADO</option></select></label></div>
        <div><label>Fecha<br /><input type="date" name="fecha" value={form.fecha} onChange={change} required /></label></div>
        <div><label>Hora inicio<br /><input type="time" name="horaInicio" value={form.horaInicio} onChange={change} /></label></div>
        <div><label>Hora final<br /><input type="time" name="horaFinal" value={form.horaFinal} onChange={change} /></label></div>
        <div><label>Horas totales<br /><input type="number" step="0.01" name="horasTotales" value={form.horasTotales} onChange={change} /></label></div>
        <div><label>Cliente<br /><select name="clienteId" value={form.clienteId} onChange={change} required><option value="">Seleccione</option>{catalogs.clients.map((x) => <option key={x.ClienteID} value={x.ClienteID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Ubicación<br /><select name="ubicacionId" value={form.ubicacionId} onChange={change}><option value="">Seleccione</option>{locations.map((x) => <option key={x.UbicacionID} value={x.UbicacionID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Ubicación del equipo<br /><select name="ubicacionEquipoId" value={form.ubicacionEquipoId} onChange={change}><option value="">Seleccione</option>{equipmentLocations.map((x) => <option key={x.UbicacionEquipoID} value={x.UbicacionEquipoID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Supervisor<br /><select name="supervisorId" value={form.supervisorId} onChange={change}><option value="">Seleccione</option>{contacts.filter((x) => x.EsSupervisor).map((x) => <option key={x.ContactoID} value={x.ContactoID}>{x.Nombre} - {x.Correo}</option>)}</select></label></div>
        <div><label>Correo del cliente<br /><input type="email" name="correoCliente" value={form.correoCliente} onChange={change} /></label></div>
        <div><label>Correo del supervisor<br /><input type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={change} /></label></div>
        <div><label>Categoría<br /><select name="categoriaId" value={form.categoriaId} onChange={change}><option value="">Seleccione</option>{catalogs.categories.map((x) => <option key={x.CategoriaID} value={x.CategoriaID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Tipo de dispositivo<br /><select name="tipoDispositivoId" value={form.tipoDispositivoId} onChange={change}><option value="">Seleccione</option>{catalogs.deviceTypes.map((x) => <option key={x.TipoDispositivoID} value={x.TipoDispositivoID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>ID o nombre del dispositivo<br /><input name="dispositivoId" value={form.dispositivoId} onChange={change} /></label></div>
        <div><label>Fabricante<br /><select name="fabricanteId" value={form.fabricanteId} onChange={change}><option value="">Seleccione</option>{catalogs.manufacturers.map((x) => <option key={x.FabricanteID} value={x.FabricanteID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Modelo<br /><select name="modeloId" value={form.modeloId} onChange={change}><option value="">Seleccione</option>{filteredModels.map((x) => <option key={x.ModeloID} value={x.ModeloID}>{x.Nombre}</option>)}</select></label></div>
        <div><label>Serie<br /><input name="serie" value={form.serie} onChange={change} /></label></div>
        <div><label>Técnicos asignados<br /><select multiple size="6" value={form.asignados} onChange={changeAssigned} required>{catalogs.users.map((x) => <option key={x.UsuarioID} value={x.UsuarioID}>{x.NombreCompleto}</option>)}</select></label></div>
        <div><label>Tipo de falla<br /><input name="tipoFalla" value={form.tipoFalla} onChange={change} /></label></div>
        <div><label>Razón de visita<br /><textarea name="razonVisita" value={form.razonVisita} onChange={change} /></label></div>
        <div><label>Descripción<br /><textarea name="descripcion" value={form.descripcion} onChange={change} /></label></div>
        <div><label>Pruebas realizadas<br /><textarea name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={change} /></label></div>
        <div><label>Resultado<br /><textarea name="resultado" value={form.resultado} onChange={change} /></label></div>
        <div><label>Recomendaciones<br /><textarea name="recomendaciones" value={form.recomendaciones} onChange={change} /></label></div>
        <div><label><input type="checkbox" name="enviarCorreoCliente" checked={form.enviarCorreoCliente} onChange={change} /> Enviar copia al cliente posteriormente</label></div>
        <div><label>Correos CC<br /><input name="correosCC" value={form.correosCC} onChange={change} /></label></div>
        <button disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>{' '}<Link to="/boletas/pendientes">Cancelar</Link>
      </form>
    </main>
  );
}

function BoletaDetail() {
  const { boletaUid } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [upload, setUpload] = useState({ nombre: '', nota: '', file: null });
  const [uploading, setUploading] = useState(false);

  async function load() {
    try { setData(await apiRequest('boletas.get', { boletaUid }, sessionToken)); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [boletaUid, sessionToken]);

  async function uploadEvidence(event) {
    event.preventDefault();
    if (!upload.file) return;
    setUploading(true); setError('');
    try {
      const base64 = await fileToBase64(upload.file);
      await apiRequest('boletas.evidence.upload', {
        boletaUid, nombre: upload.nombre || upload.file.name, nota: upload.nota,
        fileName: upload.file.name, mimeType: upload.file.type || 'application/octet-stream', base64,
      }, sessionToken);
      setUpload({ nombre: '', nota: '', file: null });
      event.target.reset();
      await load();
    } catch (err) { setError(err.message); } finally { setUploading(false); }
  }

  async function editEvidence(item) {
    const nombre = window.prompt('Nombre de la evidencia', item.Nombre || '');
    if (nombre === null) return;
    const nota = window.prompt('Nota', item.Nota || '');
    if (nota === null) return;
    try { await apiRequest('boletas.evidence.update', { evidenciaId: item.EvidenciaID, nombre, nota }, sessionToken); await load(); }
    catch (err) { setError(err.message); }
  }

  async function deleteEvidence(item) {
    if (!window.confirm('¿Eliminar esta evidencia?')) return;
    try { await apiRequest('boletas.evidence.delete', { evidenciaId: item.EvidenciaID }, sessionToken); await load(); }
    catch (err) { setError(err.message); }
  }

  async function changeState(estado) {
    try { await apiRequest('boletas.update', { boletaUid, estado }, sessionToken); await load(); }
    catch (err) { setError(err.message); }
  }

  if (!data) return <><ErrorMessage message={error} /><Loading /></>;
  const b = data.boleta;

  return (
    <main>
      <h1>Boleta {b.BoletaID}: {b.Titulo}</h1>
      <ErrorMessage message={error} />
      <p><strong>Estado:</strong> {b.Estado}</p><p><strong>Fecha:</strong> {b.Fecha ? new Date(b.Fecha).toLocaleDateString() : ''}</p>
      <p><strong>Cliente:</strong> {b.Cliente}</p><p><strong>Ubicación:</strong> {b.Ubicacion}</p><p><strong>Ubicación del equipo:</strong> {b.UbicacionEquipo}</p>
      <p><strong>Supervisor:</strong> {b.Supervisor}</p><p><strong>Correos:</strong> {b.CorreoCliente} {b.CorreoSupervisor}</p>
      <p><strong>Categoría:</strong> {b.Categoria}</p><p><strong>Dispositivo:</strong> {[b.TipoDispositivo, b.DispositivoID, b.Fabricante, b.Modelo, b.Serie].filter(Boolean).join(' - ')}</p>
      <p><strong>Asignados:</strong> {(data.asignados || []).map((x) => x.NombreCompleto).join(', ')}</p>
      <p><strong>Razón de visita:</strong> {b.RazonVisita}</p><p><strong>Descripción:</strong> {b.Descripcion}</p>
      <p><strong>Pruebas:</strong> {b.PruebasRealizadas}</p><p><strong>Resultado:</strong> {b.Resultado}</p><p><strong>Recomendaciones:</strong> {b.Recomendaciones}</p>
      {hasPermission('BOLETAS_EDITAR') && <p><Link to={`/boletas/${boletaUid}/editar`}>Editar boleta</Link>{' | '}<button type="button" onClick={() => changeState(b.Estado === 'FINALIZADO' ? 'PENDIENTE' : 'FINALIZADO')}>{b.Estado === 'FINALIZADO' ? 'Volver a pendiente' : 'Marcar finalizada sin PDF'}</button></p>}
      <h2>Evidencias</h2>
      {(data.evidencias || []).length === 0 ? <p>No hay evidencias.</p> : <ul>{data.evidencias.map((e) => <li key={e.EvidenciaID}><a href={e.ArchivoURL} target="_blank" rel="noreferrer">{e.Nombre}</a> — {e.Nota} {hasPermission('BOLETAS_EVIDENCIAS') && <><button type="button" onClick={() => editEvidence(e)}>Editar</button><button type="button" onClick={() => deleteEvidence(e)}>Eliminar</button></>}</li>)}</ul>}
      {hasPermission('BOLETAS_EVIDENCIAS') && <form onSubmit={uploadEvidence}><h3>Agregar evidencia</h3><div><label>Nombre<br /><input value={upload.nombre} onChange={(e) => setUpload((x) => ({ ...x, nombre: e.target.value }))} /></label></div><div><label>Nota<br /><textarea value={upload.nota} onChange={(e) => setUpload((x) => ({ ...x, nota: e.target.value }))} /></label></div><div><label>Archivo<br /><input type="file" onChange={(e) => setUpload((x) => ({ ...x, file: e.target.files?.[0] || null }))} required /></label></div><button disabled={uploading}>{uploading ? 'Subiendo...' : 'Agregar evidencia'}</button></form>}
      <p><Link to={b.Estado === 'FINALIZADO' ? '/boletas/finalizadas' : '/boletas/pendientes'}>Volver</Link></p>
    </main>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BoletasApp() {
  return <Routes><Route path="/*" element={<BoletasLayout />} /></Routes>;
}
