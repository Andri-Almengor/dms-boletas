import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState({
    clients: [],
    users: [],
    categories: [],
    deviceTypes: [],
    manufacturers: [],
    models: [],
    failureTypes: [],
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      apiRequest('clients.list', { page: 1, pageSize: 200, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
      apiRequest('users.list', { page: 1, pageSize: 200, sortBy: 'NombreCompleto', sortDir: 'asc' }, sessionToken),
      apiRequest('catalog.categories.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.deviceTypes.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.manufacturers.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.models.list', { page: 1, pageSize: 200, activo: true }, sessionToken),
      apiRequest('catalog.failureTypes.list', { page: 1, pageSize: 200, activo: true, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken),
    ])
      .then(([clients, users, categories, deviceTypes, manufacturers, models, failureTypes]) => {
        if (!active) return;
        setData({
          clients: clients.items || [],
          users: (users.items || []).filter((user) => user.Estado === 'ACTIVO'),
          categories: categories.items || [],
          deviceTypes: deviceTypes.items || [],
          manufacturers: manufacturers.items || [],
          models: models.items || [],
          failureTypes: failureTypes.items || [],
        });
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [sessionToken, reloadToken]);

  return {
    ...data,
    error,
    loading,
    reload: () => setReloadToken((value) => value + 1),
  };
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
        <Route path="/boletas" element={<Navigate to="/boletas/pendientes" replace />} />
        <Route path="/boletas/pendientes" element={<BoletasList estado="PENDIENTE" />} />
        <Route path="/boletas/finalizadas" element={<BoletasList estado="FINALIZADO" />} />
        <Route path="/boletas/nueva" element={<BoletaForm mode="create" />} />
        <Route path="/boletas/:boletaUid" element={<BoletaDetail />} />
        <Route path="/boletas/:boletaUid/editar" element={<BoletaForm mode="edit" />} />
        <Route path="*" element={<Navigate to="/boletas/pendientes" replace />} />
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
    search: '',
    clienteId: '',
    dateFrom: '',
    dateTo: '',
    asignadoUsuarioId: '',
    categoriaId: '',
    tipoDispositivoId: '',
    fabricanteId: '',
    modeloId: '',
  });

  const filteredModels = useMemo(() => catalogs.models.filter((model) =>
    (!filters.tipoDispositivoId || model.TipoDispositivoID === filters.tipoDispositivoId) &&
    (!filters.fabricanteId || model.FabricanteID === filters.fabricanteId)
  ), [catalogs.models, filters.tipoDispositivoId, filters.fabricanteId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('boletas.list', {
        page: 1,
        pageSize: 200,
        estado,
        sortBy: 'Fecha',
        sortDir: 'desc',
        search: filters.search,
        clienteId: filters.clienteId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        categoriaId: filters.categoriaId,
        tipoDispositivoId: filters.tipoDispositivoId,
        asignadoUsuarioId: isAdmin ? filters.asignadoUsuarioId : user.UsuarioID,
      }, sessionToken);

      let rows = result.items || [];
      if (filters.fabricanteId) rows = rows.filter((row) => row.FabricanteID === filters.fabricanteId);
      if (filters.modeloId) rows = rows.filter((row) => row.ModeloID === filters.modeloId);
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

      <form onSubmit={(event) => { event.preventDefault(); load(); }}>
        <div><label>Buscar por título, dispositivo, fabricante o modelo<br /><input name="search" value={filters.search} onChange={field} /></label></div>
        <div><label>Cliente<br /><select name="clienteId" value={filters.clienteId} onChange={field}><option value="">Todos</option>{catalogs.clients.map((client) => <option key={client.ClienteID} value={client.ClienteID}>{client.Nombre}</option>)}</select></label></div>
        <div><label>Desde<br /><input type="date" name="dateFrom" value={filters.dateFrom} onChange={field} /></label></div>
        <div><label>Hasta<br /><input type="date" name="dateTo" value={filters.dateTo} onChange={field} /></label></div>
        {isAdmin && <div><label>Técnico<br /><select name="asignadoUsuarioId" value={filters.asignadoUsuarioId} onChange={field}><option value="">Todos</option>{catalogs.users.map((technician) => <option key={technician.UsuarioID} value={technician.UsuarioID}>{technician.NombreCompleto}</option>)}</select></label></div>}
        <div><label>Categoría<br /><select name="categoriaId" value={filters.categoriaId} onChange={field}><option value="">Todas</option>{catalogs.categories.map((category) => <option key={category.CategoriaID} value={category.CategoriaID}>{category.Nombre}</option>)}</select></label></div>
        <div><label>Tipo de dispositivo<br /><select name="tipoDispositivoId" value={filters.tipoDispositivoId} onChange={field}><option value="">Todos</option>{catalogs.deviceTypes.map((type) => <option key={type.TipoDispositivoID} value={type.TipoDispositivoID}>{type.Nombre}</option>)}</select></label></div>
        <div><label>Fabricante<br /><select name="fabricanteId" value={filters.fabricanteId} onChange={field}><option value="">Todos</option>{catalogs.manufacturers.map((manufacturer) => <option key={manufacturer.FabricanteID} value={manufacturer.FabricanteID}>{manufacturer.Nombre}</option>)}</select></label></div>
        <div><label>Modelo<br /><select name="modeloId" value={filters.modeloId} onChange={field}><option value="">Todos</option>{filteredModels.map((model) => <option key={model.ModeloID} value={model.ModeloID}>{model.Nombre}</option>)}</select></label></div>
        <button>Filtrar</button>{' '}
        <button type="button" onClick={() => setFilters({ search: '', clienteId: '', dateFrom: '', dateTo: '', asignadoUsuarioId: '', categoriaId: '', tipoDispositivoId: '', fabricanteId: '', modeloId: '' })}>Limpiar</button>
      </form>

      <ErrorMessage message={catalogs.error || error} />
      {loading ? <Loading /> : items.length === 0 ? <p>No hay boletas.</p> : (
        <table border="1" cellPadding="5">
          <thead><tr><th>Fecha</th><th>Boleta</th><th>Título</th><th>Cliente</th><th>Asignados</th><th>Categoría</th><th>Dispositivo</th><th>Acciones</th></tr></thead>
          <tbody>{items.map((boleta) => <tr key={boleta.BoletaUID}>
            <td>{boleta.Fecha ? new Date(boleta.Fecha).toLocaleDateString() : ''}</td>
            <td>{boleta.BoletaID}</td>
            <td>{boleta.Titulo}</td>
            <td>{boleta.Cliente}</td>
            <td>{(boleta.asignados || []).map((assigned) => assigned.NombreCompleto).join(', ')}</td>
            <td>{boleta.Categoria}</td>
            <td>{[boleta.TipoDispositivo, boleta.Fabricante, boleta.Modelo].filter(Boolean).join(' - ')}</td>
            <td>
              <Link to={`/boletas/${boleta.BoletaUID}`}>Ver</Link>
              {hasPermission('BOLETAS_EDITAR') && <>{' | '}<Link to={`/boletas/${boleta.BoletaUID}/editar`}>Editar</Link></>}
              {isAdmin && <>{' | '}<button type="button" onClick={() => remove(boleta)}>Eliminar</button></>}
            </td>
          </tr>)}</tbody>
        </table>
      )}
    </main>
  );
}

const EMPTY_FORM = {
  titulo: '',
  estado: 'PENDIENTE',
  fecha: new Date().toISOString().slice(0, 10),
  horaInicio: '',
  horaFinal: '',
  horasTotales: 0,
  clienteId: '',
  ubicacionId: '',
  ubicacionEquipoId: '',
  supervisorId: '',
  correoCliente: '',
  correoSupervisor: '',
  categoriaId: '',
  tipoDispositivoId: '',
  dispositivoId: '',
  fabricanteId: '',
  modeloId: '',
  serie: '',
  razonVisita: '',
  descripcion: '',
  pruebasRealizadas: '',
  resultado: '',
  recomendaciones: '',
  tipoFalla: '',
  asignados: [],
  enviarCorreoCliente: false,
  correosCC: '',
};

function SignaturePad({ existingSignatureUrl, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#000000';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function point(event) {
    const canvas = canvasRef.current;
    const rectangle = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: (source.clientX - rectangle.left) * (canvas.width / rectangle.width),
      y: (source.clientY - rectangle.top) * (canvas.height / rectangle.height),
    };
  }

  function start(event) {
    event.preventDefault();
    drawingRef.current = true;
    const context = canvasRef.current.getContext('2d');
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
  }

  function move(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext('2d');
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  function stop(event) {
    if (event) event.preventDefault();
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }

  return (
    <div>
      <label>Firma dibujada</label><br />
      {existingSignatureUrl && <p>Firma actual: <a href={existingSignatureUrl} target="_blank" rel="noreferrer">Ver firma</a></p>}
      <canvas
        ref={canvasRef}
        width="600"
        height="220"
        style={{ border: '1px solid black', width: '100%', maxWidth: '600px', touchAction: 'none' }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
      />
      <br />
      <button type="button" onClick={clear}>Limpiar firma</button>
    </div>
  );
}

function BoletaForm({ mode }) {
  const { boletaUid } = useParams();
  const { sessionToken, user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const catalogs = useCatalogs();
  const [form, setForm] = useState(EMPTY_FORM);
  const [locations, setLocations] = useState([]);
  const [equipmentLocations, setEquipmentLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [signatureData, setSignatureData] = useState('');
  const [existingSignatureUrl, setExistingSignatureUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit') {
      setForm((current) => ({ ...current, asignados: [user.UsuarioID] }));
      return;
    }

    apiRequest('boletas.get', { boletaUid }, sessionToken)
      .then((data) => {
        const boleta = data.boleta;
        setExistingSignatureUrl(boleta.FirmaURL || '');
        setForm({
          titulo: boleta.Titulo || '',
          estado: boleta.Estado || 'PENDIENTE',
          fecha: boleta.Fecha ? new Date(boleta.Fecha).toISOString().slice(0, 10) : '',
          horaInicio: boleta.HoraInicio || '',
          horaFinal: boleta.HoraFinal || '',
          horasTotales: boleta.HorasTotales || 0,
          clienteId: boleta.ClienteID || '',
          ubicacionId: boleta.UbicacionID || '',
          ubicacionEquipoId: boleta.UbicacionEquipoID || '',
          supervisorId: boleta.SupervisorID || '',
          correoCliente: boleta.CorreoCliente || '',
          correoSupervisor: boleta.CorreoSupervisor || '',
          categoriaId: boleta.CategoriaID || '',
          tipoDispositivoId: boleta.TipoDispositivoID || '',
          dispositivoId: boleta.DispositivoID || '',
          fabricanteId: boleta.FabricanteID || '',
          modeloId: boleta.ModeloID || '',
          serie: boleta.Serie || '',
          razonVisita: boleta.RazonVisita || '',
          descripcion: boleta.Descripcion || '',
          pruebasRealizadas: boleta.PruebasRealizadas || '',
          resultado: boleta.Resultado || '',
          recomendaciones: boleta.Recomendaciones || '',
          tipoFalla: boleta.TipoFalla || '',
          asignados: (data.asignados || []).map((assigned) => assigned.UsuarioID),
          enviarCorreoCliente: Boolean(boleta.EnviarCorreoCliente),
          correosCC: boleta.CorreosCC || '',
        });
      })
      .catch((err) => setError(err.message));
  }, [mode, boletaUid, sessionToken, user.UsuarioID]);

  useEffect(() => {
    if (!form.clienteId) {
      setLocations([]);
      setContacts([]);
      return;
    }

    Promise.all([
      apiRequest('clientLocations.list', { clienteId: form.clienteId, activo: true, pageSize: 200 }, sessionToken),
      apiRequest('contacts.list', { clienteId: form.clienteId, activo: true, pageSize: 200 }, sessionToken),
    ])
      .then(([locationResult, contactResult]) => {
        setLocations(locationResult.items || []);
        setContacts(contactResult.items || []);
      })
      .catch((err) => setError(err.message));
  }, [form.clienteId, sessionToken]);

  useEffect(() => {
    if (!form.ubicacionId) {
      setEquipmentLocations([]);
      return;
    }

    apiRequest('equipmentLocations.list', { ubicacionId: form.ubicacionId, activo: true, pageSize: 200 }, sessionToken)
      .then((result) => setEquipmentLocations(result.items || []))
      .catch((err) => setError(err.message));
  }, [form.ubicacionId, sessionToken]);

  function change(event) {
    const { name, value, type, checked, options } = event.target;

    if (name === 'asignados') {
      const selected = Array.from(options).filter((option) => option.selected).map((option) => option.value);
      setForm((current) => ({ ...current, asignados: selected }));
      return;
    }

    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'clienteId' ? {
        ubicacionId: '',
        ubicacionEquipoId: '',
        supervisorId: '',
        correoSupervisor: '',
      } : {}),
      ...(name === 'ubicacionId' ? { ubicacionEquipoId: '' } : {}),
      ...(name === 'tipoDispositivoId' ? { modeloId: '' } : {}),
      ...(name === 'fabricanteId' ? { modeloId: '' } : {}),
    }));

    if (name === 'supervisorId') {
      const selectedContact = contacts.find((contact) => contact.ContactoID === value);
      setForm((current) => ({
        ...current,
        supervisorId: value,
        correoSupervisor: selectedContact?.Correo || '',
      }));
    }

    if (name === 'clienteId') {
      const selectedClient = catalogs.clients.find((client) => client.ClienteID === value);
      setForm((current) => ({
        ...current,
        clienteId: value,
        correoCliente: selectedClient?.CorreoGeneral || '',
      }));
    }
  }

  async function addLocation() {
    if (!form.clienteId) return setError('Seleccione primero un cliente.');
    const nombre = window.prompt('Nombre de la nueva ubicación');
    if (!nombre?.trim()) return;

    try {
      const created = await apiRequest('clientLocations.create', {
        clienteId: form.clienteId,
        nombre: nombre.trim(),
        activo: true,
      }, sessionToken);
      setLocations((current) => [...current, created]);
      setForm((current) => ({ ...current, ubicacionId: created.UbicacionID, ubicacionEquipoId: '' }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addEquipmentLocation() {
    if (!form.ubicacionId) return setError('Seleccione primero una ubicación.');
    const nombre = window.prompt('Nombre de la nueva ubicación del equipo');
    if (!nombre?.trim()) return;

    try {
      const created = await apiRequest('equipmentLocations.create', {
        ubicacionId: form.ubicacionId,
        nombre: nombre.trim(),
        activo: true,
      }, sessionToken);
      setEquipmentLocations((current) => [...current, created]);
      setForm((current) => ({ ...current, ubicacionEquipoId: created.UbicacionEquipoID }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addSupervisor() {
    if (!form.clienteId) return setError('Seleccione primero un cliente.');
    const nombre = window.prompt('Nombre del nuevo supervisor');
    if (!nombre?.trim()) return;
    const correo = window.prompt('Correo del supervisor');
    if (!correo?.trim()) return setError('El correo del supervisor es obligatorio.');

    try {
      const created = await apiRequest('contacts.create', {
        clienteId: form.clienteId,
        nombre: nombre.trim(),
        correo: correo.trim(),
        esSupervisor: true,
        recibeCorreo: true,
        activo: true,
      }, sessionToken);

      setContacts((current) => [...current, created]);
      setForm((current) => ({
        ...current,
        supervisorId: created.ContactoID,
        correoSupervisor: created.Correo || correo.trim(),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addDeviceType() {
    const nombre = window.prompt('Nombre del nuevo tipo de dispositivo');
    if (!nombre?.trim()) return;
    try {
      const created = await apiRequest('catalog.deviceTypes.create', { nombre: nombre.trim(), activo: true }, sessionToken);
      catalogs.reload();
      setForm((current) => ({ ...current, tipoDispositivoId: created.TipoDispositivoID, modeloId: '' }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addManufacturer() {
    const nombre = window.prompt('Nombre del nuevo fabricante');
    if (!nombre?.trim()) return;
    try {
      const created = await apiRequest('catalog.manufacturers.create', { nombre: nombre.trim(), activo: true }, sessionToken);
      catalogs.reload();
      setForm((current) => ({ ...current, fabricanteId: created.FabricanteID, modeloId: '' }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addModel() {
    if (!form.tipoDispositivoId) return setError('Seleccione primero el tipo de dispositivo.');
    if (!form.fabricanteId) return setError('Seleccione primero el fabricante.');
    const nombre = window.prompt('Nombre del nuevo modelo');
    if (!nombre?.trim()) return;

    try {
      const created = await apiRequest('catalog.models.create', {
        tipoDispositivoId: form.tipoDispositivoId,
        fabricanteId: form.fabricanteId,
        nombre: nombre.trim(),
        activo: true,
      }, sessionToken);
      catalogs.reload();
      setForm((current) => ({ ...current, modeloId: created.ModeloID }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addFailureType() {
    const nombre = window.prompt('Nombre del nuevo tipo de falla');
    if (!nombre?.trim()) return;

    try {
      const created = await apiRequest('catalog.failureTypes.create', {
        nombre: nombre.trim(),
        activo: true,
      }, sessionToken);
      catalogs.reload();
      setForm((current) => ({ ...current, tipoFalla: created.Nombre }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadSignature(targetBoletaUid) {
    if (!signatureData) return;
    await apiRequest('boletas.signature.upload', {
      boletaUid: targetBoletaUid,
      base64: signatureData,
      mimeType: 'image/png',
      fileName: `firma_boleta_${targetBoletaUid}.png`,
    }, sessionToken);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (mode === 'create') {
        const result = await apiRequest('boletas.create', form, sessionToken);
        const createdUid = result.boleta.BoletaUID;
        await uploadSignature(createdUid);
        navigate(`/boletas/${createdUid}`);
      } else {
        await apiRequest('boletas.update', { boletaUid, ...form }, sessionToken);
        await uploadSignature(boletaUid);
        navigate(`/boletas/${boletaUid}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const models = catalogs.models.filter((model) =>
    (!form.tipoDispositivoId || model.TipoDispositivoID === form.tipoDispositivoId) &&
    (!form.fabricanteId || model.FabricanteID === form.fabricanteId)
  );

  const canUseForm = mode === 'create'
    ? hasPermission('BOLETAS_CREAR')
    : hasPermission('BOLETAS_EDITAR');

  if (!canUseForm) return <Navigate to="/boletas/pendientes" replace />;

  return (
    <main>
      <h1>{mode === 'create' ? 'Crear boleta' : 'Editar boleta'}</h1>
      <ErrorMessage message={catalogs.error || error} />

      <form onSubmit={submit}>
        <div><label>Título<br /><input name="titulo" value={form.titulo} onChange={change} required /></label></div>
        <div><label>Fecha<br /><input type="date" name="fecha" value={form.fecha} onChange={change} required /></label></div>

        <div>
          <label>Cliente<br />
            <select name="clienteId" value={form.clienteId} onChange={change} required>
              <option value="">Seleccione</option>
              {catalogs.clients.map((client) => <option key={client.ClienteID} value={client.ClienteID}>{client.Nombre}</option>)}
            </select>
          </label>
        </div>

        <div>
          <label>Ubicación<br />
            <select name="ubicacionId" value={form.ubicacionId} onChange={change}>
              <option value="">Seleccione</option>
              {locations.map((location) => <option key={location.UbicacionID} value={location.UbicacionID}>{location.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addLocation}>Agregar nueva ubicación</button>
        </div>

        <div>
          <label>Ubicación del equipo<br />
            <select name="ubicacionEquipoId" value={form.ubicacionEquipoId} onChange={change}>
              <option value="">Seleccione</option>
              {equipmentLocations.map((location) => <option key={location.UbicacionEquipoID} value={location.UbicacionEquipoID}>{location.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addEquipmentLocation}>Agregar ubicación del equipo</button>
        </div>

        <div>
          <label>Supervisor<br />
            <select name="supervisorId" value={form.supervisorId} onChange={change}>
              <option value="">Seleccione</option>
              {contacts.map((contact) => <option key={contact.ContactoID} value={contact.ContactoID}>{contact.Nombre} - {contact.Correo}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addSupervisor}>Agregar supervisor</button>
        </div>

        <div><label>Correo del cliente<br /><input type="email" name="correoCliente" value={form.correoCliente} onChange={change} /></label></div>
        <div><label>Correo del supervisor<br /><input type="email" name="correoSupervisor" value={form.correoSupervisor} onChange={change} readOnly /></label></div>

        <div><label>Categoría<br /><select name="categoriaId" value={form.categoriaId} onChange={change}><option value="">Seleccione</option>{catalogs.categories.map((category) => <option key={category.CategoriaID} value={category.CategoriaID}>{category.Nombre}</option>)}</select></label></div>

        <div>
          <label>Tipo de dispositivo<br />
            <select name="tipoDispositivoId" value={form.tipoDispositivoId} onChange={change}>
              <option value="">Seleccione</option>
              {catalogs.deviceTypes.map((type) => <option key={type.TipoDispositivoID} value={type.TipoDispositivoID}>{type.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addDeviceType}>Agregar tipo</button>
        </div>

        <div>
          <label>Fabricante<br />
            <select name="fabricanteId" value={form.fabricanteId} onChange={change}>
              <option value="">Seleccione</option>
              {catalogs.manufacturers.map((manufacturer) => <option key={manufacturer.FabricanteID} value={manufacturer.FabricanteID}>{manufacturer.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addManufacturer}>Agregar fabricante</button>
        </div>

        <div>
          <label>Modelo<br />
            <select name="modeloId" value={form.modeloId} onChange={change}>
              <option value="">Seleccione</option>
              {models.map((model) => <option key={model.ModeloID} value={model.ModeloID}>{model.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addModel}>Agregar modelo</button>
        </div>

        <div><label>Dispositivo / identificador<br /><input name="dispositivoId" value={form.dispositivoId} onChange={change} /></label></div>
        <div><label>Serie<br /><input name="serie" value={form.serie} onChange={change} /></label></div>

        <div>
          <label>Tipo de falla<br />
            <select name="tipoFalla" value={form.tipoFalla} onChange={change}>
              <option value="">Seleccione</option>
              {catalogs.failureTypes.map((failure) => <option key={failure.TipoFallaID} value={failure.Nombre}>{failure.Nombre}</option>)}
            </select>
          </label>{' '}
          <button type="button" onClick={addFailureType}>Agregar tipo de falla</button>
        </div>

        <div><label>Razón de visita<br /><textarea name="razonVisita" value={form.razonVisita} onChange={change} /></label></div>
        <div><label>Descripción<br /><textarea name="descripcion" value={form.descripcion} onChange={change} /></label></div>
        <div><label>Pruebas realizadas<br /><textarea name="pruebasRealizadas" value={form.pruebasRealizadas} onChange={change} /></label></div>
        <div><label>Resultado<br /><textarea name="resultado" value={form.resultado} onChange={change} /></label></div>
        <div><label>Recomendaciones<br /><textarea name="recomendaciones" value={form.recomendaciones} onChange={change} /></label></div>
        <div><label>Hora inicio<br /><input type="time" name="horaInicio" value={form.horaInicio} onChange={change} /></label></div>
        <div><label>Hora final<br /><input type="time" name="horaFinal" value={form.horaFinal} onChange={change} /></label></div>
        <div><label>Horas totales<br /><input type="number" step="0.01" name="horasTotales" value={form.horasTotales} onChange={change} /></label></div>

        <div>
          <label>Técnicos asignados<br />
            <select multiple name="asignados" value={form.asignados} onChange={change} size="6">
              {catalogs.users.map((technician) => <option key={technician.UsuarioID} value={technician.UsuarioID}>{technician.NombreCompleto}</option>)}
            </select>
          </label>
          <p><button type="button" onClick={catalogs.reload}>Actualizar lista de técnicos</button></p>
        </div>

        <div>
          <label>
            <input type="checkbox" name="enviarCorreoCliente" checked={form.enviarCorreoCliente} onChange={change} />
            Enviar copia al correo del cliente
          </label>
        </div>
        <div><label>Correos CC adicionales, separados por coma<br /><input name="correosCC" value={form.correosCC} onChange={change} /></label></div>

        <SignaturePad existingSignatureUrl={existingSignatureUrl} onChange={setSignatureData} />

        <p>
          <button disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>{' '}
          <Link to="/boletas/pendientes">Cancelar</Link>
        </p>
      </form>
    </main>
  );
}

function BoletaDetail() {
  const { boletaUid } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  async function load() {
    try {
      const result = await apiRequest('boletas.get', { boletaUid }, sessionToken);
      setData(result);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [boletaUid, sessionToken]);

  async function finalize(testMode) {
    const message = testMode
      ? '¿Generar PDF y enviar únicamente al Chat y correo de prueba? La boleta seguirá pendiente.'
      : '¿Finalizar la boleta, generar PDF y enviar correo y Google Chat?';

    if (!window.confirm(message)) return;

    setProcessing(true);
    setError('');
    try {
      if (testMode) {
        const result = await apiRequest('boletas.testFinalize', { boletaUid }, sessionToken);
        window.alert(`Prueba enviada correctamente.\nPDF: ${result.artifacts?.pdfUrl || 'generado'}`);
      } else {
        const result = await apiRequest('boletas.finalize', {
          boletaUid,
          testMode: false,
          sendClientCopy: Boolean(data.boleta.EnviarCorreoCliente),
          cc: data.boleta.CorreosCC || '',
        }, sessionToken);
        if (!result.notification?.ok) {
          setError(result.notification?.error || 'La boleta se finalizó, pero ocurrió un error de notificación.');
        }
        await load();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function returnToPending() {
    if (!window.confirm('¿Volver esta boleta a pendiente?')) return;
    setProcessing(true);
    setError('');
    try {
      await apiRequest('boletas.update', { boletaUid, estado: 'PENDIENTE' }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  if (error && !data) return <ErrorMessage message={error} />;
  if (!data) return <Loading />;

  const boleta = data.boleta;

  return (
    <main>
      <h1>Boleta {boleta.BoletaID}: {boleta.Titulo}</h1>
      <ErrorMessage message={error} />
      <p><strong>Estado:</strong> {boleta.Estado}</p>
      <p><strong>Fecha:</strong> {boleta.Fecha ? new Date(boleta.Fecha).toLocaleDateString() : ''}</p>
      <p><strong>Cliente:</strong> {boleta.Cliente}</p>
      <p><strong>Ubicación:</strong> {boleta.Ubicacion}</p>
      <p><strong>Ubicación del equipo:</strong> {boleta.UbicacionEquipo}</p>
      <p><strong>Supervisor:</strong> {boleta.Supervisor}</p>
      <p><strong>Correo del supervisor:</strong> {boleta.CorreoSupervisor}</p>
      <p><strong>Asignados:</strong> {(data.asignados || []).map((assigned) => assigned.NombreCompleto).join(', ')}</p>
      <p><strong>Categoría:</strong> {boleta.Categoria}</p>
      <p><strong>Dispositivo:</strong> {[boleta.TipoDispositivo, boleta.Fabricante, boleta.Modelo].filter(Boolean).join(' - ')}</p>
      <p><strong>Tipo de falla:</strong> {boleta.TipoFalla}</p>
      <p><strong>Serie:</strong> {boleta.Serie}</p>
      <p><strong>Razón de visita:</strong> {boleta.RazonVisita}</p>
      <p><strong>Descripción:</strong> {boleta.Descripcion}</p>
      <p><strong>Pruebas realizadas:</strong> {boleta.PruebasRealizadas}</p>
      <p><strong>Resultado:</strong> {boleta.Resultado}</p>
      <p><strong>Recomendaciones:</strong> {boleta.Recomendaciones}</p>
      <p><strong>Firma:</strong> {boleta.FirmaURL ? <a href={boleta.FirmaURL} target="_blank" rel="noreferrer">Ver firma</a> : 'Sin firma'}</p>
      {boleta.DocumentoURL && <p><strong>Documento:</strong> <a href={boleta.DocumentoURL} target="_blank" rel="noreferrer">Abrir documento</a></p>}
      {boleta.PDFURL && <p><strong>PDF:</strong> <a href={boleta.PDFURL} target="_blank" rel="noreferrer">Abrir PDF</a></p>}
      {boleta.CarpetaURL && <p><strong>Carpeta:</strong> <a href={boleta.CarpetaURL} target="_blank" rel="noreferrer">Abrir carpeta</a></p>}

      {hasPermission('BOLETAS_EDITAR') && (
        <p>
          <Link to={`/boletas/${boletaUid}/editar`}>Editar boleta</Link>{' | '}
          {boleta.Estado !== 'FINALIZADO' ? (
            <>
              <button type="button" disabled={processing} onClick={() => finalize(false)}>
                {processing ? 'Procesando...' : 'Finalizar, generar PDF y enviar'}
              </button>
              {hasPermission('NOTIFICACIONES_PRUEBA') && (
                <>
                  {' | '}
                  <button type="button" disabled={processing} onClick={() => finalize(true)}>
                    Probar PDF, Chat y correo
                  </button>
                </>
              )}
            </>
          ) : (
            <button type="button" disabled={processing} onClick={returnToPending}>
              Volver a pendiente
            </button>
          )}
        </p>
      )}

      <EvidenceManager boletaUid={boletaUid} evidences={data.evidencias || []} reload={load} />
      <p><Link to={boleta.Estado === 'FINALIZADO' ? '/boletas/finalizadas' : '/boletas/pendientes'}>Volver</Link></p>
    </main>
  );
}

function EvidenceManager({ boletaUid, evidences, reload }) {
  const { sessionToken, hasPermission } = useAuth();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const canEdit = hasPermission('BOLETAS_EVIDENCIAS');

  async function upload(event) {
    event.preventDefault();
    if (!file) return setError('Seleccione un archivo.');

    try {
      const base64 = await fileToBase64(file);
      await apiRequest('boletas.evidence.upload', {
        boletaUid,
        nombre: name || file.name,
        nota: note,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
      }, sessionToken);
      setName('');
      setNote('');
      setFile(null);
      event.target.reset();
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function edit(item) {
    const nombre = window.prompt('Nombre de la evidencia', item.Nombre || '');
    if (nombre === null) return;
    const nota = window.prompt('Nota', item.Nota || '');
    if (nota === null) return;

    try {
      await apiRequest('boletas.evidence.update', {
        evidenciaId: item.EvidenciaID,
        nombre,
        nota,
      }, sessionToken);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(item) {
    if (!window.confirm('¿Eliminar esta evidencia?')) return;
    try {
      await apiRequest('boletas.evidence.delete', { evidenciaId: item.EvidenciaID }, sessionToken);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h2>Evidencias</h2>
      <ErrorMessage message={error} />

      {evidences.length === 0 ? <p>No hay evidencias.</p> : (
        <ul>
          {evidences.map((evidence) => (
            <li key={evidence.EvidenciaID}>
              <a href={evidence.ArchivoURL} target="_blank" rel="noreferrer">{evidence.Nombre}</a>
              {evidence.Nota ? ` - ${evidence.Nota}` : ''}
              {canEdit && <>{' | '}<button type="button" onClick={() => edit(evidence)}>Editar</button>{' | '}<button type="button" onClick={() => remove(evidence)}>Eliminar</button></>}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={upload}>
          <div><label>Nombre<br /><input value={name} onChange={(event) => setName(event.target.value)} /></label></div>
          <div><label>Nota<br /><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label></div>
          <div><label>Archivo<br /><input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label></div>
          <button>Agregar evidencia</button>
        </form>
      )}
    </section>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BoletasApp() {
  return <BoletasLayout />;
}
