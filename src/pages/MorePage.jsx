import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import InstallAppCard from '../components/pwa/InstallAppCard';
import useOfflineMode from '../hooks/useOfflineMode';
import { getOfflineStorageStats } from '../services/offlineStore';
import { applyTheme, getStoredTheme } from '../services/theme';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'D'}${parts[1]?.[0] || 'M'}`.toUpperCase();
}

function MenuRow({ to, icon, label, note }) {
  return <Link to={to} className="menu-row"><span className="menu-row__icon"><Icon name={icon} /></span><div><strong>{label}</strong>{note && <small>{note}</small>}</div><Icon name="chevron_right" /></Link>;
}

function AppearanceSelector({ theme, onChange }) {
  const choices = [
    { value: 'light', icon: 'light_mode', label: 'Modo claro', note: 'Apariencia actual' },
    { value: 'dark', icon: 'dark_mode', label: 'Modo oscuro', note: 'Reduce el brillo de la interfaz' },
  ];
  return <section className="appearance-selector" aria-label="Apariencia de la aplicación">
    <div className="appearance-selector__heading"><span className="menu-row__icon"><Icon name="palette" /></span><div><strong>Apariencia</strong><small>Elija cómo desea ver la aplicación en este dispositivo.</small></div></div>
    <div className="appearance-selector__options">
      {choices.map((choice) => <button key={choice.value} type="button" className={`appearance-option${theme === choice.value ? ' is-selected' : ''}`} onClick={() => onChange(choice.value)} aria-pressed={theme === choice.value}>
        <span className={`appearance-option__preview appearance-option__preview--${choice.value}`}><span /><span /><span /></span>
        <span className="appearance-option__copy"><Icon name={choice.icon} /><span><strong>{choice.label}</strong><small>{choice.note}</small></span></span>
        <span className="appearance-option__check"><Icon name={theme === choice.value ? 'check_circle' : 'radio_button_unchecked'} /></span>
      </button>)}
    </div>
  </section>;
}

function OfflineModeSelector({ enabled, pendingCount, onToggle }) {
  return <section className={`offline-mode-selector${enabled ? ' is-enabled' : ''}`} aria-label="Modo sin conexión">
    <span className="menu-row__icon"><Icon name={enabled ? 'offline_bolt' : 'speed'} /></span>
    <div className="offline-mode-selector__copy">
      <strong>Modo sin conexión</strong>
      <small>{enabled
        ? 'Descarga catálogos y habilita la cola de sincronización para trabajar sin internet.'
        : 'Desactivado para evitar descargas, almacenamiento y sincronización en segundo plano. La recuperación de formularios permanece activa.'}</small>
      {enabled && pendingCount > 0 && <em>{pendingCount} cambio{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'} de sincronización.</em>}
    </div>
    <button type="button" className="offline-mode-switch" role="switch" aria-checked={enabled} onClick={onToggle} title={enabled ? 'Desactivar modo sin conexión' : 'Activar modo sin conexión'}>
      <span />
      <b>{enabled ? 'Activo' : 'Inactivo'}</b>
    </button>
  </section>;
}

export default function MorePage() {
  const { user, logout, hasPermission } = useAuth();
  const [offlineEnabled, setOfflineEnabled] = useOfflineMode();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [offlineStats, setOfflineStats] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canManageKnowledgeCategories = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || isAdmin;
  const canViewCatalogs = hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR') || isAdmin;
  const canViewMaintenance = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER']
    .some((permission) => hasPermission(permission));
  const canViewPasswordVault = isAdmin || ['CLIENTES_VER','BOLETAS_VER','MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR']
    .some((permission) => hasPermission(permission));

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!offlineEnabled) {
        if (active) setOfflineStats(null);
        return Promise.resolve(null);
      }
      return getOfflineStorageStats()
        .then((stats) => { if (active) setOfflineStats(stats); return stats; })
        .catch(() => null);
    };
    const handleStart = () => {
      if (!active || !offlineEnabled) return;
      setSyncing(true);
      setSyncMessage('Sincronizando los cambios guardados...');
    };
    const handleComplete = (event) => {
      if (!active || !offlineEnabled) return;
      setSyncing(false);
      const count = Number(event.detail?.synchronized || 0);
      setSyncMessage(count > 0
        ? `${count} cambio${count === 1 ? '' : 's'} sincronizado${count === 1 ? '' : 's'} correctamente.`
        : 'Todo está sincronizado y el contenido offline fue actualizado.');
      load();
    };
    const handleError = (event) => {
      if (!active || !offlineEnabled) return;
      setSyncing(false);
      setSyncMessage(event.detail?.message || 'No fue posible completar la sincronización.');
      load();
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      setOnline(false);
      setSyncing(false);
      if (offlineEnabled) setSyncMessage('No hay conexión. Los cambios permanecen guardados en este dispositivo.');
    };
    const handleTheme = (event) => {
      if (active && event.detail?.theme) setTheme(event.detail.theme);
    };

    load();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', load);
    window.addEventListener('dms-offline-sync-start', handleStart);
    window.addEventListener('dms-offline-sync-complete', handleComplete);
    window.addEventListener('dms-offline-sync-error', handleError);
    window.addEventListener('dms-theme-change', handleTheme);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', load);
      window.removeEventListener('dms-offline-sync-start', handleStart);
      window.removeEventListener('dms-offline-sync-complete', handleComplete);
      window.removeEventListener('dms-offline-sync-error', handleError);
      window.removeEventListener('dms-theme-change', handleTheme);
    };
  }, [offlineEnabled]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function forceSync() {
    if (!offlineEnabled || !online || syncing) return;
    setSyncing(true);
    setSyncMessage('Solicitando sincronización manual...');
    window.dispatchEvent(new CustomEvent('dms-offline-sync-request', { detail: { source: 'more-page' } }));
  }

  async function toggleOfflineMode() {
    setSyncMessage('');
    if (offlineEnabled) {
      const stats = offlineStats || await getOfflineStorageStats().catch(() => null);
      const pendingCount = Number(stats?.pendingCount || 0);
      if (pendingCount > 0) {
        setSyncMessage(`No se puede desactivar todavía: hay ${pendingCount} cambio${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}. Sincronice primero.`);
        return;
      }
      setOfflineEnabled(false);
      setOfflineStats(null);
      setSyncing(false);
      setSyncMessage('Modo sin conexión desactivado. La recuperación automática de formularios continúa activa.');
      return;
    }

    setOfflineEnabled(true);
    setSyncMessage(online
      ? 'Modo sin conexión activado. La base operativa se descargará en segundo plano.'
      : 'Modo sin conexión activado. La descarga comenzará cuando regrese internet.');
  }

  function changeTheme(nextTheme) {
    setTheme(applyTheme(nextTheme));
  }

  const offlineNote = !offlineEnabled
    ? 'La recuperación de formularios sigue activa; solo la base offline está desactivada'
    : offlineStats
      ? `${offlineStats.percent}% descargado · ${offlineStats.totalRecords.toLocaleString('es-CR')} registros · ${offlineStats.pendingCount} pendiente${offlineStats.pendingCount === 1 ? '' : 's'}`
      : 'Preparando la información para trabajar sin internet';
  const pendingCount = Number(offlineStats?.pendingCount || 0);
  const syncNote = syncMessage || (online
    ? pendingCount
      ? `${pendingCount} cambio${pendingCount === 1 ? '' : 's'} esperando envío. Presione para sincronizar ahora.`
      : 'Comprueba la cola y actualiza los catálogos guardados.'
    : 'Disponible cuando regrese la conexión a internet.');

  return <div className="page more-page">
    <section className="profile-card more-page__profile"><span className="profile-card__accent" /><div className="avatar avatar--xlarge">{initials(user?.NombreCompleto)}</div><div><h1>{user?.NombreCompleto}</h1><p>{isAdmin ? 'Administrador' : 'Técnico'}</p><span className="status-chip status-chip--active">{user?.Estado || 'ACTIVO'}</span></div></section>

    <div className="more-page__columns">
      <div className="more-page__column more-page__column--left">
        <section className="menu-section more-page__section more-page__section--application">
          <h2>Aplicación</h2>
          <AppearanceSelector theme={theme} onChange={changeTheme} />
          <InstallAppCard />
          <OfflineModeSelector enabled={offlineEnabled} pendingCount={pendingCount} onToggle={toggleOfflineMode} />
          {syncMessage && <div className={`more-page-inline-message${syncMessage.startsWith('No se puede') ? ' is-warning' : ''}`}><Icon name={syncMessage.startsWith('No se puede') ? 'warning' : 'info'} /><span>{syncMessage}</span></div>}
          <div className="menu-list more-page__offline-menu">
            <MenuRow to="/mas/contenido-offline" icon="download_for_offline" label="Contenido sin conexión" note={offlineNote} />
            {offlineEnabled && <button type="button" className="menu-row more-sync-row" onClick={forceSync} disabled={!online || syncing}><span className="menu-row__icon"><Icon name={syncing ? 'sync' : online ? 'sync_alt' : 'cloud_off'} /></span><div><strong>{syncing ? 'Sincronizando...' : 'Forzar sincronización'}</strong><small>{syncNote}</small></div><Icon name={syncing ? 'progress_activity' : 'refresh'} /></button>}
          </div>
        </section>

        <section className="menu-section more-page__section more-page__section--documentation">
          <h2>Documentación</h2>
          <div className="menu-list"><MenuRow to="/conocimiento" icon="menu_book" label="Base de conocimientos" note="Tutoriales, videos y procedimientos técnicos" />{canManageKnowledgeCategories && <MenuRow to="/conocimiento/categorias" icon="category" label="Categorías de conocimiento" note="Lenel, Milestone, Axis y otras tecnologías" />}</div>
        </section>
      </div>

      <div className="more-page__column more-page__column--right">
        {canViewMaintenance && <section className="menu-section more-page__section more-page__section--operation">
          <h2>Operación técnica</h2>
          <div className="menu-list"><MenuRow to="/mantenimientos" icon="engineering" label="Mantenimientos" note="Equipos, checklists, evidencias, Excel y presentaciones" /></div>
        </section>}

        <section className="menu-section more-page__section more-page__section--administration">
          <h2>Administración</h2>
          <div className="menu-list">
            {isAdmin && <MenuRow to="/casos" icon="support_agent" label="Casos de clientes" note="Solicitudes, asignación de técnicos y boletas automáticas" />}
            {canViewPasswordVault && <MenuRow to="/credenciales" icon="shield_lock" label="Contraseñas de clientes" note="Credenciales cifradas, organizadas por cliente y categoría" />}
            {isAdmin && <MenuRow to="/metricas" icon="monitoring" label="Métricas operativas" note="Dashboards de boletas y mantenimientos" />}
            {isAdmin && <MenuRow to="/administracion/importar-boletas" icon="upload_file" label="Importar boletas anteriores" note="Migrar el historial XLSX de la aplicación anterior" />}
            {hasPermission('CLIENTES_VER') && <MenuRow to="/clientes" icon="groups" label="Clientes" note="Clientes, ubicaciones y contactos" />}
            {isAdmin && <MenuRow to="/encuestas" icon="rate_review" label="Encuestas de servicio" note="Preguntas, calificaciones y boletas relacionadas" />}
            {hasPermission('USUARIOS_VER') && <MenuRow to="/usuarios" icon="person_search" label="Usuarios" note="Accesos, roles y permisos" />}
            {canViewCatalogs && <MenuRow to="/catalogos" icon="inventory_2" label="Catálogos" note="Categorías, dispositivos, fabricantes y modelos" />}
            {canViewCatalogs && <MenuRow to="/catalogos/preguntas-mantenimiento" icon="rule" label="Preguntas de mantenimiento" note="Preguntas Sí/No relacionadas con cada tipo de dispositivo" />}
            <MenuRow to="/cambiar-contrasena" icon="lock_reset" label="Cambiar contraseña" note="Seguridad de la cuenta" />
          </div>
        </section>

        <section className="menu-section more-page__section more-page__section--session">
          <h2>Sesión</h2>
          <button type="button" className="logout-row" onClick={handleLogout}><span className="menu-row__icon"><Icon name="logout" /></span><div><strong>Cerrar sesión</strong><small>Salir de forma segura</small></div></button>
        </section>
      </div>
    </div>

    <footer className="app-meta more-page__footer">DMS Boletas · Aplicación web instalable</footer>
  </div>;
}
