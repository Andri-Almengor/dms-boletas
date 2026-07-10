import React, { useEffect, useMemo, useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

function Loading() {
  return <p>Cargando...</p>;
}

function ErrorMessage({ message }) {
  return message ? <p role="alert">Error: {message}</p> : null;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? children : <Navigate to="/login" replace />;
}

function PermissionRoute({ permission, children }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : <Navigate to="/" replace />;
}

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const data = await login(username, password);
      navigate(data.mustChangePassword ? '/cambiar-contrasena' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Iniciar sesión</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="username">Usuario o correo</label><br />
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="password">Contraseña</label><br />
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorMessage message={error} />
        <button disabled={submitting}>{submitting ? 'Ingresando...' : 'Ingresar'}</button>
      </form>
    </main>
  );
}

function ChangePasswordPage() {
  const { user, sessionToken, clearSession } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiRequest('auth.changePassword', { currentPassword, newPassword }, sessionToken);
      clearSession();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <h1>Cambiar contraseña</h1>
      {user?.CambioPasswordObligatorio && <p>Debe cambiar la contraseña temporal antes de continuar.</p>}
      <form onSubmit={handleSubmit}>
        <div><label>Contraseña actual<br /><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label></div>
        <div><label>Nueva contraseña<br /><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></label></div>
        <div><label>Confirmar contraseña<br /><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} /></label></div>
        <p>Debe incluir mayúscula, minúscula y número.</p>
        <ErrorMessage message={error} />
        <button disabled={saving}>{saving ? 'Guardando...' : 'Cambiar contraseña'}</button>
      </form>
    </main>
  );
}

function AppLayout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.CambioPasswordObligatorio) navigate('/cambiar-contrasena', { replace: true });
  }, [user, navigate]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <header>
        <strong>DMS Boletas</strong>
        {' | '}<NavLink to="/">Home</NavLink>
        {hasPermission('USUARIOS_VER') && <>{' | '}<NavLink to="/usuarios">Usuarios</NavLink></>}
        {hasPermission('CLIENTES_VER') && <>{' | '}<NavLink to="/clientes">Clientes</NavLink></>}
        {' | '}<NavLink to="/cambiar-contrasena">Cambiar contraseña</NavLink>
        {' | '}<button type="button" onClick={handleLogout}>Cerrar sesión</button>
      </header>
      <hr />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="cambiar-contrasena" element={<ChangePasswordPage />} />

        <Route path="usuarios" element={<PermissionRoute permission="USUARIOS_VER"><UsersPage /></PermissionRoute>} />
        <Route path="usuarios/nuevo" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="create" /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId" element={<PermissionRoute permission="USUARIOS_VER"><UserDetailPage /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId/editar" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="edit" /></PermissionRoute>} />

        <Route path="clientes" element={<PermissionRoute permission="CLIENTES_VER"><ClientsPage /></PermissionRoute>} />
        <Route path="clientes/nuevo" element={<PermissionRoute permission="CLIENTES_CREAR"><ClientFormPage mode="create" /></PermissionRoute>} />
        <Route path="clientes/:clienteId" element={<PermissionRoute permission="CLIENTES_VER"><ClientDetailPage /></PermissionRoute>} />
        <Route path="clientes/:clienteId/editar" element={<PermissionRoute permission="CLIENTES_EDITAR"><ClientFormPage mode="edit" /></PermissionRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function HomePage() {
  const { user, hasPermission } = useAuth();
  const roleName = hasPermission('USUARIOS_GESTIONAR') ? 'Administrador' : 'Técnico';
  return (
    <main>
      <h1>Hola, {user?.NombreCompleto}</h1>
      <p>Rol: {roleName}</p>
      <p>Usuario: {user?.NombreUsuario}</p>
      <p>Correo: {user?.Correo}</p>
    </main>
  );
}

function useRoles() {
  const { sessionToken } = useAuth();
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('roles.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken)
      .then((data) => setRoles(data.items || []))
      .catch((err) => setError(err.message));
  }, [sessionToken]);

  return { roles, error };
}

function UsersPage() {
  const { sessionToken, hasPermission, user: currentUser } = useAuth();
  const { roles } = useRoles();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const roleById = useMemo(() => Object.fromEntries(roles.map((r) => [r.RolID, r.Nombre])), [roles]);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('users.list', { page: 1, pageSize: 200, search, sortBy: 'NombreCompleto', sortDir: 'asc' }, sessionToken);
      setUsers(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, [sessionToken]);

  async function deactivateUser(record) {
    if (record.UsuarioID === currentUser.UsuarioID) return window.alert('No puede desactivar su propio usuario.');
    if (!window.confirm(`¿Desactivar a ${record.NombreCompleto}?`)) return;
    try {
      await apiRequest('users.update', { usuarioId: record.UsuarioID, estado: 'INACTIVO' }, sessionToken);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <h1>Usuarios</h1>
      {hasPermission('USUARIOS_GESTIONAR') && <p><Link to="/usuarios/nuevo">Crear usuario</Link></p>}
      <form onSubmit={(e) => { e.preventDefault(); loadUsers(); }}>
        <label>Buscar <input value={search} onChange={(e) => setSearch(e.target.value)} /></label>{' '}
        <button>Buscar</button>
      </form>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : (
        <table border="1" cellPadding="5">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {users.map((record) => (
              <tr key={record.UsuarioID}>
                <td>{record.NombreCompleto}</td><td>{record.NombreUsuario}</td><td>{record.Correo}</td>
                <td>{roleById[record.RolID] || record.RolID}</td><td>{record.Estado}</td>
                <td>
                  <Link to={`/usuarios/${record.UsuarioID}`}>Ver</Link>
                  {hasPermission('USUARIOS_GESTIONAR') && <>{' | '}<Link to={`/usuarios/${record.UsuarioID}/editar`}>Editar</Link></>}
                  {hasPermission('USUARIOS_GESTIONAR') && record.Estado === 'ACTIVO' && <>{' | '}<button type="button" onClick={() => deactivateUser(record)}>Eliminar</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function UserDetailPage() {
  const { usuarioId } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const { roles } = useRoles();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('users.get', { usuarioId }, sessionToken).then(setRecord).catch((err) => setError(err.message));
  }, [usuarioId, sessionToken]);

  if (error) return <ErrorMessage message={error} />;
  if (!record) return <Loading />;
  const role = roles.find((r) => r.RolID === record.user.RolID);

  return (
    <main>
      <h1>Detalle del usuario</h1>
      <p><strong>Nombre:</strong> {record.user.NombreCompleto}</p>
      <p><strong>Usuario:</strong> {record.user.NombreUsuario}</p>
      <p><strong>Correo:</strong> {record.user.Correo}</p>
      <p><strong>Rol:</strong> {role?.Nombre || record.user.RolID}</p>
      <p><strong>Estado:</strong> {record.user.Estado}</p>
      <h2>Permisos efectivos</h2>
      <ul>{(record.permissions || []).map((p) => <li key={p}>{p}</li>)}</ul>
      {hasPermission('USUARIOS_GESTIONAR') && <p><Link to={`/usuarios/${usuarioId}/editar`}>Editar usuario</Link></p>}
      <Link to="/usuarios">Volver</Link>
    </main>
  );
}

function UserFormPage({ mode }) {
  const { usuarioId } = useParams();
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const { roles, error: rolesError } = useRoles();
  const [form, setForm] = useState({ nombreCompleto: '', nombreUsuario: '', correo: '', rolId: '', estado: 'ACTIVO' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  useEffect(() => {
    if (mode !== 'edit') return;
    apiRequest('users.get', { usuarioId }, sessionToken)
      .then((data) => setForm({
        nombreCompleto: data.user.NombreCompleto || '', nombreUsuario: data.user.NombreUsuario || '',
        correo: data.user.Correo || '', rolId: data.user.RolID || '', estado: data.user.Estado || 'ACTIVO',
      }))
      .catch((err) => setError(err.message));
  }, [mode, usuarioId, sessionToken]);

  useEffect(() => {
    if (mode === 'create' && !form.rolId && roles.length) {
      const technician = roles.find((r) => r.Nombre === 'Técnico');
      setForm((current) => ({ ...current, rolId: technician?.RolID || roles[0].RolID }));
    }
  }, [roles, mode, form.rolId]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        const data = await apiRequest('users.create', form, sessionToken);
        setTemporaryPassword(data.temporaryPassword);
      } else {
        await apiRequest('users.update', { usuarioId, ...form }, sessionToken);
        navigate(`/usuarios/${usuarioId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (temporaryPassword) {
    return <main><h1>Usuario creado</h1><p>Contraseña temporal:</p><pre>{temporaryPassword}</pre><Link to="/usuarios">Volver</Link></main>;
  }

  return (
    <main>
      <h1>{mode === 'create' ? 'Crear usuario' : 'Editar usuario'}</h1>
      <ErrorMessage message={rolesError || error} />
      <form onSubmit={handleSubmit}>
        <div><label>Nombre completo<br /><input name="nombreCompleto" value={form.nombreCompleto} onChange={updateField} required /></label></div>
        <div><label>Nombre de usuario<br /><input name="nombreUsuario" value={form.nombreUsuario} onChange={updateField} required /></label></div>
        <div><label>Correo<br /><input type="email" name="correo" value={form.correo} onChange={updateField} required /></label></div>
        <div><label>Rol<br /><select name="rolId" value={form.rolId} onChange={updateField} required><option value="">Seleccione</option>{roles.map((r) => <option key={r.RolID} value={r.RolID}>{r.Nombre}</option>)}</select></label></div>
        {mode === 'edit' && <div><label>Estado<br /><select name="estado" value={form.estado} onChange={updateField}><option>ACTIVO</option><option>INACTIVO</option></select></label></div>}
        <button disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>{' '}<Link to="/usuarios">Cancelar</Link>
      </form>
    </main>
  );
}

function ClientsPage() {
  const { sessionToken, hasPermission } = useAuth();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadClients() {
    setLoading(true);
    setError('');
    try {
      const payload = { page: 1, pageSize: 200, search, sortBy: 'Nombre', sortDir: 'asc' };
      if (activeFilter !== '') payload.activo = activeFilter;
      const data = await apiRequest('clients.list', payload, sessionToken);
      setClients(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadClients(); }, [sessionToken]);

  async function deactivateClient(client) {
    if (!window.confirm(`¿Eliminar/desactivar el cliente ${client.Nombre}?`)) return;
    try {
      await apiRequest('clients.update', { clienteId: client.ClienteID, activo: false }, sessionToken);
      await loadClients();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <h1>Clientes</h1>
      {hasPermission('CLIENTES_CREAR') && <p><Link to="/clientes/nuevo">Agregar cliente</Link></p>}
      <form onSubmit={(e) => { e.preventDefault(); loadClients(); }}>
        <label>Buscar <input value={search} onChange={(e) => setSearch(e.target.value)} /></label>{' '}
        <label>Estado <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select></label>{' '}
        <button>Buscar</button>
      </form>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : (
        <table border="1" cellPadding="5">
          <thead><tr><th>Nombre</th><th>Razón social</th><th>Correo</th><th>Teléfono</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.ClienteID}>
                <td>{client.Nombre}</td><td>{client.RazonSocial}</td><td>{client.CorreoGeneral}</td><td>{client.Telefono}</td>
                <td>{client.Activo ? 'ACTIVO' : 'INACTIVO'}</td>
                <td>
                  <Link to={`/clientes/${client.ClienteID}`}>Ver</Link>
                  {hasPermission('CLIENTES_EDITAR') && <>{' | '}<Link to={`/clientes/${client.ClienteID}/editar`}>Editar</Link></>}
                  {hasPermission('CLIENTES_EDITAR') && client.Activo && <>{' | '}<button type="button" onClick={() => deactivateClient(client)}>Eliminar</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const emptyClient = {
  nombre: '', razonSocial: '', identificacion: '', correoGeneral: '', telefono: '',
  direccion: '', chatWebhook: '', notas: '', activo: true,
};

function ClientFormPage({ mode }) {
  const { clienteId } = useParams();
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyClient);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'edit') return;
    apiRequest('clients.get', { clienteId }, sessionToken)
      .then((data) => setForm({
        nombre: data.client.Nombre || '', razonSocial: data.client.RazonSocial || '',
        identificacion: data.client.Identificacion || '', correoGeneral: data.client.CorreoGeneral || '',
        telefono: data.client.Telefono || '', direccion: data.client.Direccion || '',
        chatWebhook: data.client.ChatWebhook || '', notas: data.client.Notas || '',
        activo: Boolean(data.client.Activo),
      }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [mode, clienteId, sessionToken]);

  function updateField(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        const client = await apiRequest('clients.create', form, sessionToken);
        navigate(`/clientes/${client.ClienteID}`);
      } else {
        await apiRequest('clients.update', { clienteId, ...form }, sessionToken);
        navigate(`/clientes/${clienteId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <main>
      <h1>{mode === 'create' ? 'Agregar cliente' : 'Editar cliente'}</h1>
      <ErrorMessage message={error} />
      <form onSubmit={handleSubmit}>
        <div><label>Nombre<br /><input name="nombre" value={form.nombre} onChange={updateField} required /></label></div>
        <div><label>Razón social<br /><input name="razonSocial" value={form.razonSocial} onChange={updateField} /></label></div>
        <div><label>Identificación<br /><input name="identificacion" value={form.identificacion} onChange={updateField} /></label></div>
        <div><label>Correo general<br /><input type="email" name="correoGeneral" value={form.correoGeneral} onChange={updateField} /></label></div>
        <div><label>Teléfono<br /><input name="telefono" value={form.telefono} onChange={updateField} /></label></div>
        <div><label>Dirección<br /><textarea name="direccion" value={form.direccion} onChange={updateField} /></label></div>
        <div><label>Webhook del Chat del cliente<br /><input name="chatWebhook" value={form.chatWebhook} onChange={updateField} /></label></div>
        <div><label>Notas<br /><textarea name="notas" value={form.notas} onChange={updateField} /></label></div>
        {mode === 'edit' && <div><label><input type="checkbox" name="activo" checked={form.activo} onChange={updateField} /> Cliente activo</label></div>}
        <button disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>{' '}<Link to="/clientes">Cancelar</Link>
      </form>
    </main>
  );
}

function ClientDetailPage() {
  const { clienteId } = useParams();
  const { sessionToken, hasPermission } = useAuth();
  const [record, setRecord] = useState(null);
  const [equipmentLocations, setEquipmentLocations] = useState([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiRequest('clients.get', { clienteId }, sessionToken);
        if (cancelled) return;
        setRecord(data);
        const results = await Promise.all((data.locations || []).map((location) =>
          apiRequest('equipmentLocations.list', { page: 1, pageSize: 200, ubicacionId: location.UbicacionID }, sessionToken)
        ));
        if (!cancelled) setEquipmentLocations(results.flatMap((x) => x.items || []));
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clienteId, sessionToken, reloadKey]);

  if (error) return <ErrorMessage message={error} />;
  if (!record) return <Loading />;

  return (
    <main>
      <h1>{record.client.Nombre}</h1>
      <p><strong>Razón social:</strong> {record.client.RazonSocial || '-'}</p>
      <p><strong>Identificación:</strong> {record.client.Identificacion || '-'}</p>
      <p><strong>Correo:</strong> {record.client.CorreoGeneral || '-'}</p>
      <p><strong>Teléfono:</strong> {record.client.Telefono || '-'}</p>
      <p><strong>Dirección:</strong> {record.client.Direccion || '-'}</p>
      <p><strong>Chat:</strong> {record.client.ChatWebhook ? <a href={record.client.ChatWebhook} target="_blank" rel="noreferrer">Abrir enlace</a> : '-'}</p>
      <p><strong>Notas:</strong> {record.client.Notas || '-'}</p>
      <p><strong>Estado:</strong> {record.client.Activo ? 'ACTIVO' : 'INACTIVO'}</p>
      {hasPermission('CLIENTES_EDITAR') && <p><Link to={`/clientes/${clienteId}/editar`}>Editar cliente</Link></p>}

      <h2>Ubicaciones</h2>
      {(record.locations || []).length === 0 ? <p>No hay ubicaciones.</p> : (
        <ul>{record.locations.map((location) => <li key={location.UbicacionID}><strong>{location.Nombre}</strong> — {location.Direccion || 'Sin dirección'}{location.Notas ? ` — ${location.Notas}` : ''}</li>)}</ul>
      )}
      {hasPermission('CLIENTES_CREAR') && <LocationCreateForm clienteId={clienteId} sessionToken={sessionToken} onCreated={() => setReloadKey((x) => x + 1)} />}

      <h2>Ubicaciones del equipo</h2>
      {equipmentLocations.length === 0 ? <p>No hay ubicaciones de equipo.</p> : (
        <ul>{equipmentLocations.map((location) => {
          const parent = (record.locations || []).find((x) => x.UbicacionID === location.UbicacionID);
          return <li key={location.UbicacionEquipoID}><strong>{location.Nombre}</strong> — Ubicación: {parent?.Nombre || location.UbicacionID}{location.Descripcion ? ` — ${location.Descripcion}` : ''}</li>;
        })}</ul>
      )}
      {hasPermission('CLIENTES_CREAR') && (record.locations || []).length > 0 && <EquipmentLocationCreateForm locations={record.locations} sessionToken={sessionToken} onCreated={() => setReloadKey((x) => x + 1)} />}

      <h2>Contactos y supervisores</h2>
      {(record.contacts || []).length === 0 ? <p>No hay contactos.</p> : (
        <table border="1" cellPadding="5">
          <thead><tr><th>Nombre</th><th>Puesto</th><th>Correo</th><th>Teléfono</th><th>Supervisor</th><th>Recibe correo</th></tr></thead>
          <tbody>{record.contacts.map((contact) => <tr key={contact.ContactoID}><td>{contact.Nombre}</td><td>{contact.Puesto}</td><td>{contact.Correo}</td><td>{contact.Telefono}</td><td>{contact.EsSupervisor ? 'Sí' : 'No'}</td><td>{contact.RecibeCorreo ? 'Sí' : 'No'}</td></tr>)}</tbody>
        </table>
      )}
      {hasPermission('CLIENTES_CREAR') && <ContactCreateForm clienteId={clienteId} sessionToken={sessionToken} onCreated={() => setReloadKey((x) => x + 1)} />}
      <p><Link to="/clientes">Volver a clientes</Link></p>
    </main>
  );
}

function LocationCreateForm({ clienteId, sessionToken, onCreated }) {
  const [form, setForm] = useState({ nombre: '', direccion: '', notas: '' });
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      await apiRequest('clientLocations.create', { clienteId, ...form }, sessionToken);
      setForm({ nombre: '', direccion: '', notas: '' });
      onCreated();
    } catch (err) { setError(err.message); }
  }
  return <form onSubmit={submit}><h3>Agregar ubicación</h3><ErrorMessage message={error} /><div><label>Nombre <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label></div><div><label>Dirección <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></label></div><div><label>Notas <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></label></div><button>Agregar ubicación</button></form>;
}

function EquipmentLocationCreateForm({ locations, sessionToken, onCreated }) {
  const [form, setForm] = useState({ ubicacionId: locations[0]?.UbicacionID || '', nombre: '', descripcion: '' });
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      await apiRequest('equipmentLocations.create', form, sessionToken);
      setForm((current) => ({ ...current, nombre: '', descripcion: '' }));
      onCreated();
    } catch (err) { setError(err.message); }
  }
  return <form onSubmit={submit}><h3>Agregar ubicación del equipo</h3><ErrorMessage message={error} /><div><label>Ubicación <select value={form.ubicacionId} onChange={(e) => setForm({ ...form, ubicacionId: e.target.value })}>{locations.map((x) => <option key={x.UbicacionID} value={x.UbicacionID}>{x.Nombre}</option>)}</select></label></div><div><label>Nombre <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label></div><div><label>Descripción <input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></label></div><button>Agregar ubicación del equipo</button></form>;
}

function ContactCreateForm({ clienteId, sessionToken, onCreated }) {
  const [form, setForm] = useState({ nombre: '', puesto: '', correo: '', telefono: '', esSupervisor: true, recibeCorreo: true, notas: '' });
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      await apiRequest('contacts.create', { clienteId, ...form }, sessionToken);
      setForm({ nombre: '', puesto: '', correo: '', telefono: '', esSupervisor: true, recibeCorreo: true, notas: '' });
      onCreated();
    } catch (err) { setError(err.message); }
  }
  return <form onSubmit={submit}><h3>Agregar contacto o supervisor</h3><ErrorMessage message={error} /><div><label>Nombre <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label></div><div><label>Puesto <input value={form.puesto} onChange={(e) => setForm({ ...form, puesto: e.target.value })} /></label></div><div><label>Correo <input type="email" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></label></div><div><label>Teléfono <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></label></div><div><label><input type="checkbox" checked={form.esSupervisor} onChange={(e) => setForm({ ...form, esSupervisor: e.target.checked })} /> Es supervisor</label></div><div><label><input type="checkbox" checked={form.recibeCorreo} onChange={(e) => setForm({ ...form, recibeCorreo: e.target.checked })} /> Recibe correo</label></div><button>Agregar contacto</button></form>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
    </Routes>
  );
}
