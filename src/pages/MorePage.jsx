import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Icon from '../components/common/Icon';
import InstallAppCard from '../components/pwa/InstallAppCard';
import { getOfflineStorageStats } from '../services/offlineStore';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'D'}${parts[1]?.[0] || 'M'}`.toUpperCase();
}

function MenuRow({ to, icon, label, note }) {
  return <Link to={to} className="menu-row"><span className="menu-row__icon"><Icon name={icon} /></span><div><strong>{label}</strong>{note && <small>{note}</small>}</div><Icon name="chevron_right" /></Link>;
}

export default function MorePage() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [offlineStats, setOfflineStats] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const isAdmin = hasPermission('USUARIOS_GESTIONAR');
  const canManageKnowledgeCategories = hasPermission('CONOCIMIENTO_CATEGORIAS_GESTIONAR') || isAdmin;
  const canViewMaintenance = ['MANTENIMIENTOS_VER','MANTENIMIENTOS_CREAR','MANTENIMIENTOS_EDITAR','MANTENIMIENTOS_GESTIONAR','BOLETAS_VER']
    .some((permission) => hasPermission(permission));

  useEffect(() => {
    let active = true;
    const load = () => getOfflineStorageStats()
      .then((stats) => { if (active) setOfflineStats(stats); })
      .catch(() => {});
    const handleStart = () => {
      if (!active) return;
      setSyncing(true);
      setSyncMessage('Sincronizando los cambios guardados...');
    };
    const handleComplete = (event) => {
      if (!active) return;
      setSyncing(false);
      const count = Number(event.detail?.synchronized || 0);
      setSyncMessage(count > 0
        ? `${count} cambio${count === 1 ? '' : 's'} sincronizado${count === 1 ? '' : 's'} correctamente.`
        : 'Todo está sincronizado y el contenido offline fue actualizado.');
      load();
    };
    const handleError = (event) => {
      if (!active) return;
      setSyncing(false);
      setSyncMessage(event.detail?.message || 'No fue posible completar la sincronización.');
      load();
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      setOnline(false);
      setSyncing(false);
      setSyncMessage('No hay conexión. Los cambios permanecen guardados en este dispositivo.');
    };

    load();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dms-offline-queue-change', load);
    window.addEventListener('dms-offline-sync-start', handleStart);
    window.addEventListener('dms-offline-sync-complete', handleComplete);
    window.addEventListener('dms-offline-sync-error', handleError);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dms-offline-queue-change', load);
      window.removeEventListener('dms-offline-sync-start', handleStart);
      window.removeEventListener('dms-offline-sync-complete', handleComplete);
      window.removeEventListener('dms-offline-sync-error', handleError);
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function forceSync() {
    if (!online || syncing) return;
    setSyncing(true);
    setSyncMessage('Solicitando sincronización manual...');
    window.dispatchEvent(new CustomEvent('dms-offline-sync-request', {
      detail: { source: 'more-page' },
    }));
  }

  const offlineNote = offlineStats
    ? `${offlineStats.percent}% descargado · ${offlineStats.totalRecords.toLocaleString('es-CR')} registros · ${offlineStats.pendingCount} pendiente${offlineStats.pendingCount === 1 ? '' : 's'}`
    : 'Revise clientes, ubicaciones, dispositivos y cambios disponibles sin internet';
  const pendingCount = Number(offlineStats?.pendingCount || 0);
  const syncNote = syncMessage || (online
    ? pendingCount
      ? `${pendingCount} cambio${pendingCount === 1 ? '' : 's'} esperando envío. Presione para sincronizar ahora.`
      : 'Comprueba la cola y actualiza los catálogos guardados.'
    : 'Disponible cuando regrese la conexión a internet.');

  return <div className="page more-page">
    <section className="profile-card more-page__profile"><span className="profile-card__accent" /><div className="avatar avatar--xlarge">{initials(user?.NombreCompleto)}</div><div><h1>{user?.NombreCompleto}</h1><p>{isAdmin ? 'Administrador' : 'Técnico'}</p><span className="status-chip status-chip--active">{user?.Estado || 'ACTIVO'}</span></div></section>
    <section className="menu-section"><h2>Aplicación</h2><InstallAppCard /><div className="menu-list more-page__offline-menu"><MenuRow to="/mas/contenido-offline" icon="download_for_offline" label="Contenido sin conexión" note={offlineNote} /><button type="button" className="menu-row more-sync-row" onClick={forceSync} disabled={!online || syncing}><span className="menu-row__icon"><Icon name={syncing ? 'sync' : online ? 'sync_alt' : 'cloud_off'} /></span><div><strong>{syncing ? 'Sincronizando...' : 'Forzar sincronización'}</strong><small>{syncNote}</small></div><Icon name={syncing ? 'progress_activity' : 'refresh'} /></button></div></section>
    <section className="menu-section"><h2>Operación técnica</h2><div className="menu-list">{canViewMaintenance && <MenuRow to="/mantenimientos" icon="engineering" label="Mantenimientos" note="Equipos, checklists, evidencias, Excel y presentaciones" />}</div></section>
    <section className="menu-section"><h2>Documentación</h2><div className="menu-list"><MenuRow to="/conocimiento" icon="menu_book" label="Base de conocimientos" note="Tutoriales, videos y procedimientos técnicos" />{canManageKnowledgeCategories && <MenuRow to="/conocimiento/categorias" icon="category" label="Categorías de conocimiento" note="Lenel, Milestone, Axis y otras tecnologías" />}</div></section>
    <section className="menu-section"><h2>Administración</h2><div className="menu-list">{hasPermission('CLIENTES_VER') && <MenuRow to="/clientes" icon="groups" label="Clientes" note="Clientes, ubicaciones y contactos" />}{isAdmin && <MenuRow to="/encuestas" icon="rate_review" label="Encuestas de servicio" note="Preguntas, calificaciones y boletas relacionadas" />}{hasPermission('USUARIOS_VER') && <MenuRow to="/usuarios" icon="person_search" label="Usuarios" note="Accesos, roles y permisos" />}{(hasPermission('CATALOGOS_VER') || hasPermission('CATALOGOS_GESTIONAR')) && <MenuRow to="/catalogos" icon="inventory_2" label="Catálogos" note="Categorías, dispositivos, fabricantes y modelos" />}<MenuRow to="/cambiar-contrasena" icon="lock_reset" label="Cambiar contraseña" note="Seguridad de la cuenta" /></div></section>
    <section className="menu-section more-page__session"><h2>Sesión</h2><button type="button" className="logout-row" onClick={handleLogout}><span className="menu-row__icon"><Icon name="logout" /></span><div><strong>Cerrar sesión</strong><small>Salir de forma segura</small></div></button></section>
    <footer className="app-meta more-page__footer">DMS Boletas · Aplicación web instalable</footer>
  </div>;
}
