import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

const ROUTES = {
  ticketsList: ['boletas.list', 'tickets.list'],
  ticketsGet: ['boletas.get', 'tickets.get'],
  ticketsCreate: ['boletas.create', 'tickets.create'],
  clientsList: ['clients.list', 'clientes.list'],
  clientsCreate: ['clients.create', 'clientes.create'],
  clientsUpdate: ['clients.update', 'clientes.update'],
  categoriesList: ['categories.list', 'categorias.list'],
  categoriesCreate: ['categories.create', 'categorias.create'],
  categoriesUpdate: ['categories.update', 'categorias.update'],
};

const pick = (object, keys, fallback = '') => {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};

const normalizeItems = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const isMissingRouteError = (error) => {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('route') || text.includes('ruta') || text.includes('not_found') || text.includes('no encontrada');
};

async function requestFirstAvailable(routes, payload, sessionToken) {
  let lastError;
  for (const route of routes) {
    try {
      return await apiRequest(route, payload, sessionToken);
    } catch (error) {
      lastError = error;
      if (!isMissingRouteError(error)) throw error;
    }
  }
  throw lastError || new Error('La operación todavía no está disponible en el backend.');
}

function Icon({ name, filled = false, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
    >
      {name}
    </span>
  );
}

function Loading({ label = 'Cargando información...' }) {
  return (
    <div className="state-card" aria-live="polite">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}

function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="error" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ icon = 'inbox', title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-screen"><Loading /></div>;
  return user ? children : <Navigate to="/login" replace />;
}

function PermissionRoute({ permission, children }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : <Navigate to="/" replace />;
}

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="auth-screen">
      <div className="auth-glow" />
      <section className="auth-wrap">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="description" /></div>
          <h1>DMS Boletas</h1>
        </div>

        <div className="auth-card">
          <div className="auth-heading">
            <h2>Bienvenido</h2>
            <p>Inicia sesión para continuar con tus operaciones.</p>
          </div>

          {location.state?.passwordChanged && (
            <div className="alert alert-success">
              <Icon name="check_circle" />
              <span>Contraseña actualizada. Inicia sesión nuevamente.</span>
            </div>
          )}

          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Usuario o correo</span>
              <div className="input-shell">
                <Icon name="person" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="nombre@empresa.com"
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>Contraseña</span>
              <div className="input-shell">
                <Icon name="lock" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
                <button
                  className="icon-button input-action"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
                </button>
              </div>
            </label>

            <ErrorMessage message={error} />

            <button className="button button-primary button-block" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner spinner-light" /> Ingresando...</> : <>Ingresar <Icon name="login" /></>}
            </button>
          </form>
        </div>

        <footer className="auth-footer">
          <p>DMS Boletas v2.1</p>
          <span><Icon name="verified_user" /> Conexión segura</span>
        </footer>
      </section>
    </main>
  );
}

function ChangePasswordPage() {
  const { user, sessionToken, clearSession } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
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

  const mandatory = Boolean(user?.CambioPasswordObligatorio);

  return (
    <Page title="Cambiar contraseña" backTo={mandatory ? undefined : '/mas'}>
      <section className="surface-card password-card">
        <div className="section-title with-accent">
          <div>
            <span className="eyebrow">Seguridad de la cuenta</span>
            <h2>{mandatory ? 'Crea una contraseña personal' : 'Actualiza tu contraseña'}</h2>
            <p>{mandatory ? 'Debes reemplazar la contraseña temporal antes de continuar.' : 'Utiliza una contraseña distinta a las anteriores.'}</p>
          </div>
          <div className="round-icon"><Icon name="lock_reset" /></div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <PasswordInput label="Contraseña actual" value={currentPassword} onChange={setCurrentPassword} show={show} />
          <PasswordInput label="Nueva contraseña" value={newPassword} onChange={setNewPassword} show={show} minLength={8} />
          <PasswordInput label="Confirmar contraseña" value={confirmPassword} onChange={setConfirmPassword} show={show} minLength={8} />

          <button className="text-button inline-control" type="button" onClick={() => setShow((current) => !current)}>
            <Icon name={show ? 'visibility_off' : 'visibility'} />
            {show ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
          </button>

          <div className="password-rules">
            <Icon name="info" />
            <div>
              <strong>La contraseña debe incluir:</strong>
              <span>mínimo 8 caracteres, una mayúscula, una minúscula y un número.</span>
            </div>
          </div>

          <ErrorMessage message={error} />

          <button className="button button-primary button-block" disabled={submitting}>
            {submitting ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </section>
    </Page>
  );
}

function PasswordInput({ label, value, onChange, show, minLength }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <Icon name="lock" />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={minLength}
          autoComplete="new-password"
        />
      </div>
    </label>
  );
}

function AppLayout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (user?.CambioPasswordObligatorio) navigate('/cambiar-contrasena', { replace: true });
  }, [user, navigate]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <TopBar user={user} onMenu={() => setDrawerOpen(true)} />
      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        canManageUsers={hasPermission('USUARIOS_VER')}
        onLogout={handleLogout}
      />

      <Routes>
        <Route index element={<HomePage />} />
        <Route path="boletas/pendientes" element={<TicketListPage status="PENDIENTE" />} />
        <Route path="boletas/finalizadas" element={<TicketListPage status="FINALIZADA" />} />
        <Route path="boletas/nueva" element={<CreateTicketPage />} />
        <Route path="boletas/:boletaId" element={<TicketDetailPage />} />
        <Route path="mas" element={<MorePage onLogout={handleLogout} />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="categorias" element={<CategoriesPage />} />
        <Route path="cambiar-contrasena" element={<ChangePasswordPage />} />
        <Route path="usuarios" element={<PermissionRoute permission="USUARIOS_VER"><UsersPage /></PermissionRoute>} />
        <Route path="usuarios/nuevo" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="create" /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId" element={<PermissionRoute permission="USUARIOS_VER"><UserDetailPage /></PermissionRoute>} />
        <Route path="usuarios/:usuarioId/editar" element={<PermissionRoute permission="USUARIOS_GESTIONAR"><UserFormPage mode="edit" /></PermissionRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <BottomNav />
    </div>
  );
}

function TopBar({ user, onMenu }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button" type="button" onClick={onMenu} aria-label="Abrir menú">
          <Icon name="menu" />
        </button>
        <Link className="topbar-brand" to="/">DMS Boletas</Link>
      </div>
      <Link className="avatar avatar-small" to="/mas" aria-label="Perfil">
        {getInitials(user?.NombreCompleto)}
      </Link>
    </header>
  );
}

function SideDrawer({ open, onClose, user, canManageUsers, onLogout }) {
  return (
    <div className={`drawer-layer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="Cerrar menú" />
      <aside className="drawer">
        <div className="drawer-header">
          <div className="avatar">{getInitials(user?.NombreCompleto)}</div>
          <div>
            <strong>{user?.NombreCompleto || 'Usuario DMS'}</strong>
            <span>{user?.Correo || user?.NombreUsuario}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose}><Icon name="close" /></button>
        </div>
        <nav className="drawer-nav" onClick={onClose}>
          <NavLink to="/"><Icon name="home" /> Inicio</NavLink>
          <NavLink to="/boletas/pendientes"><Icon name="pending_actions" /> Boletas pendientes</NavLink>
          <NavLink to="/boletas/finalizadas"><Icon name="task_alt" /> Boletas finalizadas</NavLink>
          <NavLink to="/clientes"><Icon name="groups" /> Clientes</NavLink>
          <NavLink to="/categorias"><Icon name="category" /> Categorías</NavLink>
          {canManageUsers && <NavLink to="/usuarios"><Icon name="manage_accounts" /> Usuarios</NavLink>}
          <NavLink to="/cambiar-contrasena"><Icon name="lock_reset" /> Cambiar contraseña</NavLink>
        </nav>
        <button className="drawer-logout" type="button" onClick={onLogout}><Icon name="logout" /> Cerrar sesión</button>
      </aside>
    </div>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav">
      <BottomLink to="/" icon="home" label="Inicio" end />
      <BottomLink to="/boletas/pendientes" icon="pending_actions" label="Pendientes" />
      <NavLink className="bottom-create" to="/boletas/nueva">
        <span><Icon name="add" /></span>
        <small>Crear</small>
      </NavLink>
      <BottomLink to="/boletas/finalizadas" icon="task_alt" label="Finalizadas" />
      <BottomLink to="/mas" icon="more_horiz" label="Más" />
    </nav>
  );
}

function BottomLink({ to, icon, label, end = false }) {
  return (
    <NavLink className={({ isActive }) => `bottom-link ${isActive ? 'active' : ''}`} to={to} end={end}>
      {({ isActive }) => <><Icon name={icon} filled={isActive} /><small>{label}</small></>}
    </NavLink>
  );
}

function Page({ title, backTo, actions, children, className = '' }) {
  const navigate = useNavigate();
  return (
    <main className={`page ${className}`}>
      {(title || backTo || actions) && (
        <div className="page-heading">
          <div className="page-heading-main">
            {backTo !== undefined && (
              <button className="icon-button back-button" type="button" onClick={() => backTo ? navigate(backTo) : navigate(-1)}>
                <Icon name="arrow_back" />
              </button>
            )}
            {title && <h1>{title}</h1>}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

function HomePage() {
  const { user, hasPermission, sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    let mounted = true;
    requestFirstAvailable(ROUTES.ticketsList, { page: 1, pageSize: 8, sortBy: 'Fecha', sortDir: 'desc' }, sessionToken)
      .then((data) => { if (mounted) setTickets(normalizeItems(data)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [sessionToken]);

  const pending = tickets.filter((ticket) => normalizeStatus(ticket) === 'PENDIENTE').length;
  const finished = tickets.filter((ticket) => normalizeStatus(ticket) === 'FINALIZADA').length;
  const roleName = hasPermission('USUARIOS_GESTIONAR') ? 'Administrador' : 'Técnico de Campo';

  return (
    <Page className="home-page">
      <section className="welcome-block">
        <span>Bienvenido</span>
        <h1>Hola, {firstName(user?.NombreCompleto)}</h1>
        <p><Icon name={hasPermission('USUARIOS_GESTIONAR') ? 'admin_panel_settings' : 'engineering'} /> {roleName}</p>
      </section>

      <section className="stats-grid">
        <Link className="stat-card stat-pending" to="/boletas/pendientes">
          <Icon name="pending_actions" />
          <strong>{pending}</strong>
          <span>Boletas pendientes</span>
        </Link>
        <Link className="stat-card stat-finished" to="/boletas/finalizadas">
          <Icon name="task_alt" />
          <strong>{finished}</strong>
          <span>Boletas finalizadas</span>
        </Link>
      </section>

      <Link className="create-ticket-cta" to="/boletas/nueva">
        <Icon name="add_circle" />
        <span>Crear Nueva Boleta</span>
      </Link>

      <section className="section-block">
        <div className="section-heading">
          <h2>Últimas boletas asignadas</h2>
          <Link to="/boletas/pendientes">Ver todas</Link>
        </div>
        <div className="ticket-stack">
          {tickets.length ? tickets.slice(0, 3).map((ticket, index) => (
            <TicketCard ticket={ticket} key={ticketId(ticket, index)} compact />
          )) : (
            <EmptyState
              icon="assignment"
              title="Todavía no hay boletas para mostrar"
              description="Las boletas recientes aparecerán aquí cuando el backend las entregue."
            />
          )}
        </div>
      </section>
    </Page>
  );
}

function useTickets(status) {
  const { sessionToken } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadTickets(query = search) {
    setLoading(true);
    setError('');
    try {
      const data = await requestFirstAvailable(ROUTES.ticketsList, {
        page: 1,
        pageSize: 200,
        search: query,
        estado: status,
        status,
        sortBy: 'Fecha',
        sortDir: 'desc',
      }, sessionToken);
      const items = normalizeItems(data);
      setTickets(status ? items.filter((item) => {
        const itemStatus = normalizeStatus(item);
        return !itemStatus || itemStatus === status;
      }) : items);
    } catch (err) {
      setError(err.message);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTickets(''); }, [sessionToken, status]);
  return { tickets, search, setSearch, loading, error, loadTickets };
}

function TicketListPage({ status }) {
  const { tickets, search, setSearch, loading, error, loadTickets } = useTickets(status);
  const isPending = status === 'PENDIENTE';

  const groups = useMemo(() => groupTicketsByDate(tickets), [tickets]);

  return (
    <Page title={isPending ? 'Boletas Pendientes' : 'Boletas Finalizadas'}>
      <form className="search-row sticky-search" onSubmit={(event) => { event.preventDefault(); loadTickets(); }}>
        <div className="search-field">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar boleta o cliente..."
          />
        </div>
        <button className="filter-button" type="submit" aria-label="Buscar"><Icon name="tune" /></button>
      </form>

      <ErrorMessage message={error} />
      {loading ? <Loading /> : tickets.length ? (
        <div className="date-groups">
          {groups.map((group) => (
            <section className="date-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="ticket-stack">
                {group.items.map((ticket, index) => <TicketCard ticket={ticket} key={ticketId(ticket, index)} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={isPending ? 'pending_actions' : 'task_alt'}
          title={isPending ? 'No hay boletas pendientes' : 'No hay boletas finalizadas'}
          description={error ? 'Verifica que las rutas de boletas estén disponibles en Apps Script.' : 'Cuando existan registros aparecerán en esta sección.'}
          action={isPending ? <Link className="button button-primary" to="/boletas/nueva">Crear boleta</Link> : null}
        />
      )}
    </Page>
  );
}

function TicketCard({ ticket, compact = false }) {
  const status = normalizeStatus(ticket) || 'PENDIENTE';
  const id = ticketId(ticket);
  const title = pick(ticket, ['Titulo', 'Título', 'TituloBoleta', 'title', 'TipoServicio'], 'Boleta de servicio');
  const client = pick(ticket, ['Cliente', 'ClienteNombre', 'Clientes', 'clientName'], 'Cliente sin especificar');
  const equipment = pick(ticket, ['Equipo', 'UbicacionEquipo', 'Ubicacion_equipo', 'Modelo', 'Categoria'], 'Servicio técnico');
  const date = pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
  const location = pick(ticket, ['Ubicacion', 'Ubicación', 'Direccion', 'Dirección']);

  return (
    <article className={`ticket-card ${status === 'FINALIZADA' ? 'ticket-finished' : 'ticket-pending'} ${compact ? 'ticket-compact' : ''}`}>
      <div className="ticket-card-top">
        <div>
          <span className="ticket-number">#{String(id || 'SIN-ID').slice(0, 18)}</span>
          <h3>{title}</h3>
          {compact && <p>Cliente: {client}</p>}
        </div>
        <StatusPill status={status} />
      </div>

      {!compact && (
        <div className="ticket-data-grid">
          <div><span>Cliente</span><strong>{client}</strong></div>
          <div><span>Equipo</span><strong>{equipment}</strong></div>
        </div>
      )}

      {compact ? (
        <div className="ticket-meta">
          <span><Icon name="schedule" /> {formatDate(date)}</span>
          {location && <span><Icon name="location_on" /> {location}</span>}
        </div>
      ) : (
        <div className="ticket-actions">
          <Link className="button button-primary" to={`/boletas/${encodeURIComponent(id)}`}>Ver Detalle</Link>
          <Link className="button button-icon-outline" to={`/boletas/${encodeURIComponent(id)}`} aria-label="Editar boleta"><Icon name="edit" /></Link>
        </div>
      )}
    </article>
  );
}

function StatusPill({ status }) {
  const final = String(status).toUpperCase().includes('FINAL');
  return <span className={`status-pill ${final ? 'status-final' : 'status-pending'}`}>{final ? 'Finalizada' : 'Pendiente'}</span>;
}

function TicketDetailPage() {
  const { boletaId } = useParams();
  const { sessionToken } = useAuth();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    requestFirstAvailable(ROUTES.ticketsGet, { boletaId, ticketId: boletaId, id: boletaId }, sessionToken)
      .then((data) => setRecord(data?.boleta || data?.ticket || data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [boletaId, sessionToken]);

  if (loading) return <Page title={`Boleta #${boletaId}`} backTo="/boletas/pendientes"><Loading /></Page>;

  const ticket = record || {};
  const status = normalizeStatus(ticket) || 'PENDIENTE';
  const evidence = pick(ticket, ['Evidencias', 'evidences', 'Imagenes', 'Fotos'], []);
  const evidenceList = Array.isArray(evidence) ? evidence : [];

  return (
    <Page
      title={`Boleta #${String(boletaId).slice(0, 18)}`}
      backTo="/boletas/pendientes"
      actions={<button className="icon-button" type="button" onClick={() => navigator.share?.({ title: `Boleta ${boletaId}`, url: window.location.href })}><Icon name="share" /></button>}
      className="ticket-detail-page"
    >
      <ErrorMessage message={error} />
      <section className="ticket-status-card">
        <div><span>Estado actual</span><StatusPill status={status} /></div>
        <div><span>Fecha de asignación</span><strong>{formatDate(pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt']))}</strong></div>
      </section>

      <DetailSection title="Información General" accent="primary" open>
        <InfoGrid items={[
          ['Tipo de servicio', pick(ticket, ['Categoria', 'TipoServicio', 'Categoría'], 'Servicio técnico')],
          ['Prioridad', pick(ticket, ['Prioridad'], 'Normal')],
          ['Descripción del problema', pick(ticket, ['Descripcion', 'Descripción', 'Razon_visita', 'RazonVisita'], 'Sin descripción registrada.'), true],
        ]} />
      </DetailSection>

      <DetailSection title="Cliente">
        <IconInfo icon="corporate_fare" label="Empresa / Razón Social" value={pick(ticket, ['Cliente', 'ClienteNombre', 'Clientes'], 'Sin cliente')} />
        <IconInfo icon="location_on" label="Dirección" value={pick(ticket, ['Ubicacion', 'Dirección', 'Direccion'], 'Sin dirección')} />
        <IconInfo icon="person" label="Contacto Directo" value={pick(ticket, ['Contacto', 'ContactoCliente', 'Supervisor'], 'Sin contacto')} />
      </DetailSection>

      <DetailSection title="Dispositivo / Equipo">
        <InfoGrid items={[
          ['Marca / Modelo', [pick(ticket, ['Fabricante', 'Marca']), pick(ticket, ['Modelo'])].filter(Boolean).join(' ') || 'Sin especificar'],
          ['Número de serie', pick(ticket, ['Serie', 'NumeroSerie'], 'Sin especificar')],
          ['Ubicación del equipo', pick(ticket, ['Ubicacion_equipo', 'UbicacionEquipo'], 'Sin especificar'), true],
        ]} />
      </DetailSection>

      <DetailSection title="Trabajo Realizado">
        <div className="note-box">
          <span>Notas técnicas</span>
          <p>{pick(ticket, ['Resultado', 'TrabajoRealizado', 'Pruebas_realizadas', 'PruebasRealizadas'], 'Aún no se han registrado resultados técnicos.')}</p>
        </div>
        <InfoGrid items={[
          ['Recomendaciones', pick(ticket, ['Recomendaciones'], 'Sin recomendaciones')],
          ['Horas totales', pick(ticket, ['HorasTotales'], '0')],
        ]} />
      </DetailSection>

      <section className="section-block">
        <div className="section-heading"><h2>Evidencias Fotográficas</h2></div>
        {evidenceList.length ? (
          <div className="evidence-grid">
            {evidenceList.map((item, index) => {
              const source = typeof item === 'string' ? item : pick(item, ['url', 'Url', 'Imagen', 'image']);
              return <a href={source} target="_blank" rel="noreferrer" className="evidence-tile" key={`${source}-${index}`}><img src={source} alt={`Evidencia ${index + 1}`} /><span>Evidencia {index + 1}</span></a>;
            })}
          </div>
        ) : <EmptyState icon="photo_library" title="Sin evidencias cargadas" description="Las fotografías adjuntas se mostrarán en esta galería." />}
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Firma del Cliente</h2></div>
        <div className="signature-box">
          {pick(ticket, ['Firma', 'FirmaUrl']) ? <img src={pick(ticket, ['Firma', 'FirmaUrl'])} alt="Firma del cliente" /> : <span><Icon name="draw" /> Firma pendiente</span>}
        </div>
      </section>

      <div className="detail-action-bar">
        <button className="button button-outline" type="button"><Icon name="edit" /> Editar</button>
        <button className="button button-outline" type="button"><Icon name="picture_as_pdf" /> Generar PDF</button>
        <button className="button button-primary button-wide" type="button"><Icon name="task_alt" filled /> Finalizar Boleta</button>
      </div>
    </Page>
  );
}

function DetailSection({ title, accent = 'secondary', open = false, children }) {
  return (
    <details className="detail-section" open={open}>
      <summary>
        <span className={`detail-accent ${accent}`} />
        <strong>{title}</strong>
        <Icon name="expand_more" />
      </summary>
      <div className="detail-content">{children}</div>
    </details>
  );
}

function InfoGrid({ items }) {
  return (
    <div className="info-grid">
      {items.map(([label, value, wide]) => <div className={wide ? 'wide' : ''} key={label}><span>{label}</span><strong>{String(value)}</strong></div>)}
    </div>
  );
}

function IconInfo({ icon, label, value }) {
  return <div className="icon-info"><Icon name={icon} /><div><span>{label}</span><strong>{value}</strong></div></div>;
}

const creationSteps = [
  { title: 'Información General', description: 'Ingrese los datos básicos del servicio.' },
  { title: 'Cliente', description: 'Seleccione o identifique al cliente.' },
  { title: 'Ubicación', description: 'Indique dónde se realizará el servicio.' },
  { title: 'Equipo', description: 'Registre la información del dispositivo.' },
  { title: 'Trabajo', description: 'Detalle el diagnóstico y las acciones.' },
  { title: 'Evidencias', description: 'Capture fotografías del equipo o área.' },
  { title: 'Firma', description: 'Solicite la firma de conformidad.' },
  { title: 'Revisión', description: 'Confirme la información antes de guardar.' },
];

function CreateTicketPage() {
  const { sessionToken } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    titulo: '', categoria: '', fecha: new Date().toISOString().slice(0, 10), horaInicio: '', cliente: '', contacto: '',
    ubicacion: '', fabricante: '', modelo: '', serie: '', descripcion: '', resultado: '', recomendaciones: '', firmaNombre: '',
  });
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function addImages(event) {
    const files = Array.from(event.target.files || []);
    setImages((current) => [...current, ...files.map((file) => ({ file, url: URL.createObjectURL(file), name: file.name }))]);
  }

  function nextStep() {
    setError('');
    if (step === 0 && (!form.titulo || !form.categoria || !form.fecha)) {
      setError('Complete el título, la categoría y la fecha para continuar.');
      return;
    }
    setStep((current) => Math.min(current + 1, creationSteps.length - 1));
  }

  async function submitTicket() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        Titulo: form.titulo,
        Categoria: form.categoria,
        Fecha: form.fecha,
        HoraInicio: form.horaInicio,
        Cliente: form.cliente,
        Contacto: form.contacto,
        Ubicacion: form.ubicacion,
        Fabricante: form.fabricante,
        Modelo: form.modelo,
        Serie: form.serie,
        Descripcion: form.descripcion,
        Resultado: form.resultado,
        Recomendaciones: form.recomendaciones,
        Estado: 'PENDIENTE',
      };
      const result = await requestFirstAvailable(ROUTES.ticketsCreate, payload, sessionToken);
      const id = pick(result, ['BoletaID', 'TicketID', 'id'], '');
      navigate(id ? `/boletas/${encodeURIComponent(id)}` : '/boletas/pendientes');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const progress = ((step + 1) / creationSteps.length) * 100;

  return (
    <Page title="Crear Boleta" backTo="/">
      <section className="step-progress">
        <div><strong>Paso {step + 1} de {creationSteps.length}</strong><span>{Math.round(progress)}% completado</span></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="surface-card create-form-card">
        <header className="form-step-heading">
          <h2>Paso {step + 1}: {creationSteps[step].title}</h2>
          <p>{creationSteps[step].description}</p>
        </header>

        <ErrorMessage message={error} />
        <div className="form-stack">
          {step === 0 && <>
            <TextField label="Título de la Boleta" name="titulo" value={form.titulo} onChange={updateField} placeholder="Ej: Mantenimiento preventivo Torre 4" required />
            <SelectField label="Categoría" name="categoria" value={form.categoria} onChange={updateField} options={['Mantenimiento', 'Instalación', 'Reparación', 'Inspección Técnica']} />
            <div className="form-grid two"><TextField label="Fecha de intervención" name="fecha" type="date" value={form.fecha} onChange={updateField} /><TextField label="Hora de inicio" name="horaInicio" type="time" value={form.horaInicio} onChange={updateField} /></div>
          </>}
          {step === 1 && <><TextField label="Cliente" name="cliente" value={form.cliente} onChange={updateField} placeholder="Nombre o razón social" /><TextField label="Contacto" name="contacto" value={form.contacto} onChange={updateField} placeholder="Persona de contacto" /></>}
          {step === 2 && <TextField label="Ubicación del servicio" name="ubicacion" value={form.ubicacion} onChange={updateField} placeholder="Dirección o área del equipo" multiline />}
          {step === 3 && <><div className="form-grid two"><TextField label="Fabricante" name="fabricante" value={form.fabricante} onChange={updateField} /><TextField label="Modelo" name="modelo" value={form.modelo} onChange={updateField} /></div><TextField label="Número de serie" name="serie" value={form.serie} onChange={updateField} /></>}
          {step === 4 && <><TextField label="Descripción / diagnóstico" name="descripcion" value={form.descripcion} onChange={updateField} multiline /><TextField label="Trabajo realizado" name="resultado" value={form.resultado} onChange={updateField} multiline /><TextField label="Recomendaciones" name="recomendaciones" value={form.recomendaciones} onChange={updateField} multiline /></>}
          {step === 5 && <EvidenceStep images={images} addImages={addImages} removeImage={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}
          {step === 6 && <><div className="signature-capture"><Icon name="draw" /><h3>Firma de conformidad</h3><p>Ingrese el nombre de la persona que firma. La captura manuscrita podrá conectarse al backend en esta misma sección.</p></div><TextField label="Nombre de quien firma" name="firmaNombre" value={form.firmaNombre} onChange={updateField} /></>}
          {step === 7 && <ReviewTicket form={form} images={images} />}
        </div>
      </section>

      <div className="form-bottom-actions">
        <button className="button button-outline" type="button" onClick={() => step ? setStep((current) => current - 1) : navigate('/')}>
          <Icon name={step ? 'chevron_left' : 'close'} /> {step ? 'Anterior' : 'Cancelar'}
        </button>
        {step < creationSteps.length - 1 ? (
          <button className="button button-primary button-wide" type="button" onClick={nextStep}>Siguiente <Icon name="chevron_right" /></button>
        ) : (
          <button className="button button-primary button-wide" type="button" onClick={submitTicket} disabled={saving}>{saving ? 'Guardando...' : 'Crear Boleta'} <Icon name="task_alt" /></button>
        )}
      </div>
    </Page>
  );
}

function TextField({ label, multiline = false, ...props }) {
  return <label className="field"><span>{label}</span>{multiline ? <textarea rows="4" {...props} /> : <input {...props} />}</label>;
}

function SelectField({ label, options, ...props }) {
  return <label className="field"><span>{label}</span><select {...props}><option value="">Seleccione una opción</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>;
}

function EvidenceStep({ images, addImages, removeImage }) {
  return (
    <div className="evidence-step">
      <label className="camera-button">
        <input type="file" accept="image/*" capture="environment" multiple onChange={addImages} />
        <span><Icon name="camera" filled /></span>
        <strong>Tomar Foto</strong>
      </label>
      <div className="section-heading"><h3>Archivos capturados ({images.length})</h3></div>
      <div className="evidence-grid">
        {images.map((image, index) => <div className="evidence-preview" key={`${image.name}-${index}`}><img src={image.url} alt={image.name} /><button type="button" onClick={() => removeImage(index)}><Icon name="delete" /></button><span>{image.name}</span></div>)}
        <label className="evidence-add"><input type="file" accept="image/*" multiple onChange={addImages} /><Icon name="add_a_photo" /><span>Añadir otra</span></label>
      </div>
    </div>
  );
}

function ReviewTicket({ form, images }) {
  const rows = [
    ['Título', form.titulo], ['Categoría', form.categoria], ['Fecha', form.fecha], ['Cliente', form.cliente],
    ['Ubicación', form.ubicacion], ['Equipo', [form.fabricante, form.modelo, form.serie].filter(Boolean).join(' · ')],
    ['Descripción', form.descripcion], ['Evidencias', `${images.length} archivo(s)`], ['Firma', form.firmaNombre],
  ];
  return <div className="review-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Sin especificar'}</strong></div>)}</div>;
}

function MorePage({ onLogout }) {
  const { user, hasPermission } = useAuth();
  const roleName = hasPermission('USUARIOS_GESTIONAR') ? 'Administrador' : 'Técnico de Campo';

  return (
    <Page title="Más">
      <section className="profile-card">
        <div className="avatar avatar-large">{getInitials(user?.NombreCompleto)}</div>
        <div><h2>{user?.NombreCompleto || 'Usuario DMS'}</h2><p>{roleName}</p><span>{user?.NombreUsuario}</span></div>
      </section>

      <section className="menu-section">
        <h2>Administración</h2>
        <div className="menu-list">
          <MenuItem to="/clientes" icon="groups" label="Clientes" />
          {hasPermission('USUARIOS_VER') && <MenuItem to="/usuarios" icon="person_search" label="Usuarios" />}
          <MenuItem to="/categorias" icon="inventory_2" label="Categorías" />
          <MenuItem to="/cambiar-contrasena" icon="lock_reset" label="Cambiar contraseña" />
        </div>
      </section>

      <section className="menu-section">
        <h2>Sesión</h2>
        <button className="logout-card" type="button" onClick={onLogout}><span><Icon name="logout" /></span><strong>Cerrar sesión</strong></button>
      </section>

      <footer className="app-meta"><p>DMS Boletas v2.1</p><span>© 2026 Digital Management Systems</span></footer>
    </Page>
  );
}

function MenuItem({ to, icon, label }) {
  return <Link to={to}><span className="menu-icon"><Icon name={icon} /></span><strong>{label}</strong><Icon name="chevron_right" /></Link>;
}

function useRoles() {
  const { sessionToken } = useAuth();
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');

  async function loadRoles() {
    try {
      const data = await apiRequest('roles.list', { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setRoles(normalizeItems(data));
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
      setUsers(normalizeItems(data));
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
    <Page
      title="Usuarios"
      backTo="/mas"
      actions={hasPermission('USUARIOS_GESTIONAR') ? <Link className="button button-primary button-small" to="/usuarios/nuevo"><Icon name="person_add" /> Nuevo</Link> : null}
    >
      <form className="search-row" onSubmit={(event) => { event.preventDefault(); loadUsers(); }}>
        <div className="search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuario..." /></div>
        <button className="filter-button" type="submit"><Icon name="search" /></button>
      </form>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : users.length ? (
        <div className="admin-card-list">
          {users.map((user) => {
            const active = user.Estado === 'ACTIVO';
            return (
              <article className="admin-record" key={user.UsuarioID}>
                <div className="admin-record-avatar">{getInitials(user.NombreCompleto)}</div>
                <div className="admin-record-content">
                  <div className="admin-record-title"><div><h3>{user.NombreCompleto}</h3><p>@{user.NombreUsuario}</p></div><span className={`mini-status ${active ? 'active' : 'inactive'}`}>{user.Estado}</span></div>
                  <div className="admin-record-meta"><span><Icon name="mail" /> {user.Correo}</span><span><Icon name="badge" /> {roleById[user.RolID] || user.RolID}</span></div>
                  <div className="admin-record-actions">
                    <Link className="button button-primary" to={`/usuarios/${user.UsuarioID}`}>Ver detalle</Link>
                    {hasPermission('USUARIOS_GESTIONAR') && <Link className="button button-outline" to={`/usuarios/${user.UsuarioID}/editar`}><Icon name="edit" /></Link>}
                    {hasPermission('USUARIOS_GESTIONAR') && active && <button className="button button-danger-ghost" type="button" onClick={() => deactivateUser(user)}><Icon name="person_remove" /></button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon="group_off" title="No se encontraron usuarios" description="Prueba con otro término de búsqueda." />}
    </Page>
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

  if (error) return <Page title="Detalle del usuario" backTo="/usuarios"><ErrorMessage message={error} /></Page>;
  if (!record) return <Page title="Detalle del usuario" backTo="/usuarios"><Loading /></Page>;

  const role = roles.find((item) => item.RolID === record.user.RolID);
  const active = record.user.Estado === 'ACTIVO';

  return (
    <Page
      title="Detalle del usuario"
      backTo="/usuarios"
      actions={hasPermission('USUARIOS_GESTIONAR') ? <Link className="button button-primary button-small" to={`/usuarios/${usuarioId}/editar`}><Icon name="edit" /> Editar</Link> : null}
    >
      <section className="profile-card user-detail-profile">
        <div className="avatar avatar-large">{getInitials(record.user.NombreCompleto)}</div>
        <div><h2>{record.user.NombreCompleto}</h2><p>{role?.Nombre || record.user.RolID}</p><span className={`mini-status ${active ? 'active' : 'inactive'}`}>{record.user.Estado}</span></div>
      </section>

      <section className="surface-card detail-list-card">
        <InfoRow icon="alternate_email" label="Nombre de usuario" value={record.user.NombreUsuario} />
        <InfoRow icon="mail" label="Correo" value={record.user.Correo} />
        <InfoRow icon="lock_clock" label="Cambio de contraseña obligatorio" value={record.user.CambioPasswordObligatorio ? 'Sí' : 'No'} />
      </section>

      <section className="surface-card permissions-card">
        <div className="section-heading"><h2>Permisos efectivos</h2><span>{(record.permissions || []).length}</span></div>
        <div className="permission-chips">{(record.permissions || []).map((permission) => <span key={permission}><Icon name="check_circle" filled /> {permission.replaceAll('_', ' ')}</span>)}</div>
      </section>
    </Page>
  );
}

function InfoRow({ icon, label, value }) {
  return <div className="info-row"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></div>;
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
        nombreCompleto: data.user.NombreCompleto || '', nombreUsuario: data.user.NombreUsuario || '', correo: data.user.Correo || '', rolId: data.user.RolID || '', estado: data.user.Estado || 'ACTIVO',
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
      <Page title="Usuario creado" backTo="/usuarios">
        <section className="surface-card success-card">
          <div className="success-icon"><Icon name="person_check" /></div>
          <h2>Usuario creado correctamente</h2>
          <p>Comparte esta contraseña temporal de forma segura. El usuario deberá cambiarla al iniciar sesión.</p>
          <code>{temporaryPassword}</code>
          <button className="button button-outline button-block" type="button" onClick={() => navigator.clipboard?.writeText(temporaryPassword)}><Icon name="content_copy" /> Copiar contraseña</button>
          <Link className="button button-primary button-block" to="/usuarios">Volver a usuarios</Link>
        </section>
      </Page>
    );
  }

  return (
    <Page title={mode === 'create' ? 'Crear usuario' : 'Editar usuario'} backTo={mode === 'edit' ? `/usuarios/${usuarioId}` : '/usuarios'}>
      <section className="surface-card admin-form-card">
        <div className="form-step-heading"><h2>{mode === 'create' ? 'Información del nuevo usuario' : 'Datos de la cuenta'}</h2><p>Complete los campos y asigne el rol correspondiente.</p></div>
        <ErrorMessage message={rolesError || error} />
        <form className="form-stack" onSubmit={handleSubmit}>
          <TextField label="Nombre completo" name="nombreCompleto" value={form.nombreCompleto} onChange={updateField} required />
          <TextField label="Nombre de usuario" name="nombreUsuario" value={form.nombreUsuario} onChange={updateField} required />
          <TextField label="Correo" type="email" name="correo" value={form.correo} onChange={updateField} required />
          <label className="field"><span>Rol</span><select name="rolId" value={form.rolId} onChange={updateField} required><option value="">Seleccione</option>{roles.map((role) => <option key={role.RolID} value={role.RolID}>{role.Nombre}</option>)}</select></label>
          {mode === 'edit' && <label className="field"><span>Estado</span><select name="estado" value={form.estado} onChange={updateField}><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>}
          <div className="form-submit-row"><Link className="button button-outline" to="/usuarios">Cancelar</Link><button className="button button-primary button-wide" disabled={saving}>{saving ? 'Guardando...' : 'Guardar usuario'}</button></div>
        </form>
      </section>
    </Page>
  );
}

function ClientsPage() {
  return (
    <CollectionPage
      title="Clientes"
      icon="groups"
      singular="cliente"
      routes={{ list: ROUTES.clientsList, create: ROUTES.clientsCreate, update: ROUTES.clientsUpdate }}
      idKeys={['ClienteID', 'ClientID', 'ID', 'RowID']}
      fields={[
        { name: 'nombre', label: 'Nombre / Razón social', keys: ['Clientes', 'Cliente', 'Nombre', 'NombreCliente'], required: true },
        { name: 'contacto', label: 'Contacto', keys: ['Contacto', 'NombreContacto'] },
        { name: 'correo', label: 'Correo', keys: ['Correo', 'Email'], type: 'email' },
        { name: 'telefono', label: 'Teléfono', keys: ['Telefono', 'Teléfonos', 'Telefonos'] },
        { name: 'direccion', label: 'Dirección', keys: ['Direccion', 'Dirección', 'DireccionEnvio'], multiline: true },
      ]}
      searchKeys={['Clientes', 'Cliente', 'Nombre', 'Contacto', 'Correo']}
      serialize={(form, id) => ({
        clienteId: id, id, nombre: form.nombre, cliente: form.nombre, clientes: form.nombre,
        contacto: form.contacto, correo: form.correo, telefono: form.telefono, direccion: form.direccion,
      })}
    />
  );
}

function CategoriesPage() {
  return (
    <CollectionPage
      title="Categorías"
      icon="category"
      singular="categoría"
      routes={{ list: ROUTES.categoriesList, create: ROUTES.categoriesCreate, update: ROUTES.categoriesUpdate }}
      idKeys={['CategoriaID', 'CategoryID', 'ID', 'RowID']}
      fields={[
        { name: 'nombre', label: 'Nombre de la categoría', keys: ['Categoria', 'Categoría', 'Nombre'], required: true },
        { name: 'descripcion', label: 'Descripción', keys: ['Descripcion', 'Descripción'], multiline: true },
        { name: 'estado', label: 'Estado', keys: ['Estado'], options: ['ACTIVO', 'INACTIVO'] },
      ]}
      searchKeys={['Categoria', 'Categoría', 'Nombre', 'Descripcion']}
      serialize={(form, id) => ({ categoriaId: id, id, nombre: form.nombre, categoria: form.nombre, descripcion: form.descripcion, estado: form.estado || 'ACTIVO' })}
    />
  );
}

function CollectionPage({ title, icon, singular, routes, idKeys, fields, searchKeys, serialize }) {
  const { sessionToken } = useAuth();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const blankForm = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.options ? field.options[0] : ''])), [fields]);
  const [form, setForm] = useState(blankForm);

  async function loadItems() {
    setLoading(true);
    setError('');
    try {
      const data = await requestFirstAvailable(routes.list, { page: 1, pageSize: 300, search, sortBy: 'Nombre', sortDir: 'asc' }, sessionToken);
      setItems(normalizeItems(data));
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadItems(); }, [sessionToken]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => searchKeys.some((key) => String(item?.[key] || '').toLowerCase().includes(query)));
  }, [items, search, searchKeys]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setFormOpen(true);
    setError('');
  }

  function openEdit(item) {
    setEditing(item);
    setForm(Object.fromEntries(fields.map((field) => [field.name, pick(item, field.keys, field.options ? field.options[0] : '')])));
    setFormOpen(true);
    setError('');
  }

  async function saveItem(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const id = editing ? pick(editing, idKeys) : '';
      const payload = serialize(form, id);
      await requestFirstAvailable(editing ? routes.update : routes.create, payload, sessionToken);
      setFormOpen(false);
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title={title} backTo="/mas" actions={<button className="button button-primary button-small" type="button" onClick={openCreate}><Icon name="add" /> Nuevo</button>}>
      <form className="search-row" onSubmit={(event) => event.preventDefault()}>
        <div className="search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${title.toLowerCase()}...`} /></div>
        <button className="filter-button" type="button"><Icon name="tune" /></button>
      </form>
      <ErrorMessage message={!formOpen ? error : ''} />

      {loading ? <Loading /> : filtered.length ? (
        <div className="collection-grid">
          {filtered.map((item, index) => {
            const id = pick(item, idKeys, index);
            const name = pick(item, fields[0].keys, `${singular} sin nombre`);
            const secondary = fields.slice(1).map((field) => pick(item, field.keys)).find(Boolean);
            const state = pick(item, ['Estado'], 'ACTIVO');
            return (
              <article className="collection-card" key={id}>
                <div className="collection-icon"><Icon name={icon} /></div>
                <div className="collection-content"><div><h3>{name}</h3><span className={`mini-status ${String(state).toUpperCase() === 'INACTIVO' ? 'inactive' : 'active'}`}>{state}</span></div>{secondary && <p>{secondary}</p>}<button className="text-button" type="button" onClick={() => openEdit(item)}><Icon name="edit" /> Editar {singular}</button></div>
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon={icon} title={`No hay ${title.toLowerCase()}`} description={error ? 'Verifica que las rutas del catálogo estén disponibles en Apps Script.' : `Crea el primer registro de ${singular}.`} action={<button className="button button-primary" type="button" onClick={openCreate}>Crear {singular}</button>} />}

      {formOpen && (
        <div className="modal-layer">
          <button className="modal-backdrop" type="button" onClick={() => setFormOpen(false)} aria-label="Cerrar" />
          <section className="bottom-sheet">
            <header><div><span className="eyebrow">Administración</span><h2>{editing ? `Editar ${singular}` : `Nuevo ${singular}`}</h2></div><button className="icon-button" type="button" onClick={() => setFormOpen(false)}><Icon name="close" /></button></header>
            <ErrorMessage message={error} />
            <form className="form-stack" onSubmit={saveItem}>
              {fields.map((field) => field.options ? (
                <label className="field" key={field.name}><span>{field.label}</span><select name={field.name} value={form[field.name]} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}>{field.options.map((option) => <option key={option}>{option}</option>)}</select></label>
              ) : (
                <TextField key={field.name} label={field.label} name={field.name} type={field.type || 'text'} multiline={field.multiline} value={form[field.name]} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))} required={field.required} />
              ))}
              <div className="form-submit-row"><button className="button button-outline" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="button button-primary button-wide" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></div>
            </form>
          </section>
        </div>
      )}
    </Page>
  );
}

function normalizeStatus(ticket) {
  const status = String(pick(ticket, ['Estado', 'estado', 'Status', 'status'], '')).toUpperCase();
  if (status.includes('FINAL')) return 'FINALIZADA';
  if (status.includes('PEND')) return 'PENDIENTE';
  return status;
}

function ticketId(ticket, fallback = '') {
  return pick(ticket, ['BoletaID', 'TicketID', 'ID', 'id', 'RowID'], fallback);
}

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'DMS';
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
}

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'Usuario';
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function groupTicketsByDate(tickets) {
  const groups = new Map();
  const now = new Date();
  const today = now.toDateString();
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = yesterdayDate.toDateString();

  tickets.forEach((ticket) => {
    const raw = pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
    const date = raw ? new Date(raw) : null;
    let label = 'Sin fecha';
    if (date && !Number.isNaN(date.getTime())) {
      if (date.toDateString() === today) label = 'Hoy';
      else if (date.toDateString() === yesterday) label = 'Ayer';
      else label = new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ticket);
  });

  return Array.from(groups, ([label, items]) => ({ label, items }));
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
    </Routes>
  );
}
