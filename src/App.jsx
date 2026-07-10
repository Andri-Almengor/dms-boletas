import { useEffect, useMemo, useState } from 'react';
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
    setError('');
    setSubmitting(true);
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
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label htmlFor="password">Contraseña</label><br />
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <ErrorMessage message={error} />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Ingresando...' : 'Ingresar'}
        </button>
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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('auth.changePassword', { currentPassword, newPassword }, sessionToken);
      clearSession();
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Cambiar contraseña</h1>
      {user?.CambioPasswordObligatorio && <p>Debe cambiar la contraseña temporal antes de continuar.</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="currentPassword">Contraseña actual</label><br />
          <input id="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="newPassword">Nueva contraseña</label><br />
          <input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </div>
        <div>
          <label htmlFor="confirmPassword">Confirmar contraseña</label><br />
          <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
        </div>
        <p>Debe incluir mayúscula, minúscula y número.</p>
        <ErrorMessage message={error} />
        <button disabled={submitting}>{submitting ? 'Guardando...' : 'Cambiar contraseña'}</button>
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

  async function loadRoles() {
    try {
      const data = await apiRequest('roles.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setRoles(data.items || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadRoles(); }, [sessionToken]);
  return { roles, error, reload: loadRoles };
}

function UsersPage() {
  const { sessionToken, hasPermission, user: currentUser } = useAuth();
  const { roles } = useRoles();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const roleById = useMemo(() => Object.fromEntries(roles.map((role) => [role.RolID, role.Nombre])), [roles]);

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

  async function deactivateUser(user) {
    if (user.UsuarioID === currentUser.UsuarioID) {
      window.alert('No puede desactivar su propio usuario.');
      return;
    }
    if (!window.confirm(`¿Desactivar a ${user.NombreCompleto}?`)) return;
    try {
      await apiRequest('users.update', { usuarioId: user.UsuarioID, estado: 'INACTIVO' }, sessionToken);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <h1>Usuarios</h1>
      {hasPermission('USUARIOS_GESTIONAR') && <p><Link to="/usuarios/nuevo">Crear usuario</Link></p>}
      <form onSubmit={(event) => { event.preventDefault(); loadUsers(); }}>
        <label htmlFor="search">Buscar</label>{' '}
        <input id="search" value={search} onChange={(event) => setSearch(event.target.value)} />{' '}
        <button>Buscar</button>
      </form>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : (
        <table border="1" cellPadding="5">
          <thead>
            <tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.UsuarioID}>
                <td>{user.NombreCompleto}</td>
                <td>{user.NombreUsuario}</td>
                <td>{user.Correo}</td>
                <td>{roleById[user.RolID] || user.RolID}</td>
                <td>{user.Estado}</td>
                <td>
                  <Link to={`/usuarios/${user.UsuarioID}`}>Ver</Link>
                  {hasPermission('USUARIOS_GESTIONAR') && <>{' | '}<Link to={`/usuarios/${user.UsuarioID}/editar`}>Editar</Link></>}
                  {hasPermission('USUARIOS_GESTIONAR') && user.Estado === 'ACTIVO' && <>{' | '}<button type="button" onClick={() => deactivateUser(user)}>Eliminar</button></>}
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
    apiRequest('users.get', { usuarioId }, sessionToken)
      .then(setRecord)
      .catch((err) => setError(err.message));
  }, [usuarioId, sessionToken]);

  if (error) return <ErrorMessage message={error} />;
  if (!record) return <Loading />;

  const role = roles.find((item) => item.RolID === record.user.RolID);

  return (
    <main>
      <h1>Detalle del usuario</h1>
      <p><strong>Nombre:</strong> {record.user.NombreCompleto}</p>
      <p><strong>Usuario:</strong> {record.user.NombreUsuario}</p>
      <p><strong>Correo:</strong> {record.user.Correo}</p>
      <p><strong>Rol:</strong> {role?.Nombre || record.user.RolID}</p>
      <p><strong>Estado:</strong> {record.user.Estado}</p>
      <p><strong>Cambio de contraseña obligatorio:</strong> {record.user.CambioPasswordObligatorio ? 'Sí' : 'No'}</p>
      <h2>Permisos efectivos</h2>
      <ul>{(record.permissions || []).map((permission) => <li key={permission}>{permission}</li>)}</ul>
      {hasPermission('USUARIOS_GESTIONAR') && <Link to={`/usuarios/${usuarioId}/editar`}>Editar usuario</Link>}
      <p><Link to="/usuarios">Volver</Link></p>
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
        nombreCompleto: data.user.NombreCompleto || '',
        nombreUsuario: data.user.NombreUsuario || '',
        correo: data.user.Correo || '',
        rolId: data.user.RolID || '',
        estado: data.user.Estado || 'ACTIVO',
      }))
      .catch((err) => setError(err.message));
  }, [mode, usuarioId, sessionToken]);

  useEffect(() => {
    if (mode === 'create' && !form.rolId && roles.length) {
      const tecnico = roles.find((role) => role.Nombre === 'Técnico');
      setForm((current) => ({ ...current, rolId: tecnico?.RolID || roles[0].RolID }));
    }
  }, [roles, mode, form.rolId]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        const result = await apiRequest('users.create', form, sessionToken);
        setTemporaryPassword(result.temporaryPassword);
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
    return (
      <main>
        <h1>Usuario creado</h1>
        <p>Contraseña temporal:</p>
        <pre>{temporaryPassword}</pre>
        <p>Guárdela ahora. El usuario deberá cambiarla al iniciar sesión.</p>
        <Link to="/usuarios">Volver a usuarios</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>{mode === 'create' ? 'Crear usuario' : 'Editar usuario'}</h1>
      <ErrorMessage message={rolesError || error} />
      <form onSubmit={handleSubmit}>
        <div><label>Nombre completo<br /><input name="nombreCompleto" value={form.nombreCompleto} onChange={updateField} required /></label></div>
        <div><label>Nombre de usuario<br /><input name="nombreUsuario" value={form.nombreUsuario} onChange={updateField} required /></label></div>
        <div><label>Correo<br /><input type="email" name="correo" value={form.correo} onChange={updateField} required /></label></div>
        <div>
          <label>Rol<br />
            <select name="rolId" value={form.rolId} onChange={updateField} required>
              <option value="">Seleccione</option>
              {roles.map((role) => <option key={role.RolID} value={role.RolID}>{role.Nombre}</option>)}
            </select>
          </label>
        </div>
        {mode === 'edit' && (
          <div>
            <label>Estado<br />
              <select name="estado" value={form.estado} onChange={updateField}>
                <option value="ACTIVO">ACTIVO</option>
                <option value="INACTIVO">INACTIVO</option>
              </select>
            </label>
          </div>
        )}
        <button disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>{' '}
        <Link to="/usuarios">Cancelar</Link>
      </form>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
    </Routes>
  );
}
