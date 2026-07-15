import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { getOfflineStorageStats } from '../../services/offlineStore';
import { preloadOfflineCatalogs } from '../../services/moduleApi';

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return 'Todavía no se ha descargado';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusText(section) {
  if (!section.available) return 'No descargado';
  if (section.stale) return 'Requiere actualización';
  return 'Disponible sin internet';
}

function statusIcon(section) {
  if (!section.available) return 'cloud_download';
  if (section.stale) return 'update';
  return 'offline_pin';
}

export default function OfflineContentPage() {
  const { sessionToken } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getOfflineStorageStats());
      setError('');
    } catch (err) {
      setError(err?.message || 'No fue posible leer el contenido descargado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const refresh = () => loadStats();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('dms-offline-queue-change', refresh);
    window.addEventListener('dms-offline-sync-complete', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('dms-offline-queue-change', refresh);
      window.removeEventListener('dms-offline-sync-complete', refresh);
    };
  }, [loadStats]);

  async function updateContent() {
    if (navigator.onLine === false) {
      setError('Necesita conexión a internet para actualizar el contenido descargado.');
      return;
    }
    setUpdating(true);
    setError('');
    setMessage('Descargando la base operativa más reciente...');
    try {
      const results = await preloadOfflineCatalogs(sessionToken);
      const failed = results.filter((item) => item.status === 'rejected');
      await loadStats();
      if (failed.length) {
        setMessage(`La descarga terminó con ${failed.length} sección${failed.length === 1 ? '' : 'es'} pendiente${failed.length === 1 ? '' : 's'}. Puede reintentar.`);
      } else {
        setMessage('Contenido sin conexión actualizado correctamente.');
      }
    } catch (err) {
      setError(err?.message || 'No fue posible actualizar el contenido sin conexión.');
      setMessage('');
    } finally {
      setUpdating(false);
    }
  }

  const storagePercent = useMemo(() => {
    if (!stats?.quota) return 0;
    return Math.min(100, Math.round((stats.usage / stats.quota) * 100));
  }, [stats]);

  return (
    <div className="page offline-content-page">
      <header className="page-header offline-content-page__header">
        <div>
          <Link to="/mas" className="back-link"><Icon name="arrow_back" /> Más opciones</Link>
          <span className="eyebrow">MODO SIN CONEXIÓN</span>
          <h1>Contenido descargado</h1>
          <p>Revise qué información ya está disponible para trabajar cuando el técnico se quede sin internet.</p>
        </div>
        <button type="button" className="button button--primary offline-download-button" onClick={updateContent} disabled={updating || navigator.onLine === false}>
          <Icon name={updating ? 'sync' : 'download_for_offline'} />
          {updating ? 'Actualizando...' : 'Actualizar contenido'}
        </button>
      </header>

      {message && <div className="notice notice--success"><Icon name="check_circle" /> {message}</div>}
      {error && <div className="notice notice--error"><Icon name="error" /> {error}</div>}

      {loading && !stats ? (
        <section className="empty-state"><Icon name="downloading" /><h2>Revisando almacenamiento local...</h2></section>
      ) : stats && (
        <>
          <section className="offline-summary-grid">
            <article className="offline-progress-card">
              <div className="offline-progress-ring" style={{ '--offline-progress': `${stats.percent * 3.6}deg` }}>
                <span>{stats.percent}%</span>
              </div>
              <div>
                <span className="eyebrow">DISPONIBILIDAD</span>
                <h2>{stats.readySections} de {stats.totalSections} secciones listas</h2>
                <p>{stats.percent === 100 ? 'La base operativa esencial está disponible sin internet.' : 'Actualice el contenido mientras tenga conexión para completar la descarga.'}</p>
              </div>
            </article>

            <article className="offline-metric-card">
              <span className="offline-metric-card__icon"><Icon name="database" /></span>
              <strong>{stats.totalRecords.toLocaleString('es-CR')}</strong>
              <span>registros disponibles</span>
              <small>{stats.cacheEntries} respuestas almacenadas</small>
            </article>

            <article className="offline-metric-card">
              <span className="offline-metric-card__icon"><Icon name="storage" /></span>
              <strong>{formatBytes(stats.usage || stats.approximateIndexedDbBytes)}</strong>
              <span>usados por la aplicación</span>
              <small>{stats.quota ? `${storagePercent}% del espacio permitido` : 'Estimación del almacenamiento local'}</small>
            </article>

            <article className={`offline-metric-card${stats.pendingCount ? ' has-warning' : ''}`}>
              <span className="offline-metric-card__icon"><Icon name={stats.pendingCount ? 'cloud_upload' : 'cloud_done'} /></span>
              <strong>{stats.pendingCount}</strong>
              <span>cambios pendientes</span>
              <small>{stats.errorCount ? `${stats.errorCount} requieren reintento` : 'Se enviarán al recuperar internet'}</small>
            </article>
          </section>

          <section className="offline-info-strip">
            <div><Icon name={stats.online ? 'wifi' : 'wifi_off'} /><span><strong>{stats.online ? 'Con conexión' : 'Sin conexión'}</strong><small>{stats.online ? 'Puede actualizar y sincronizar ahora.' : 'La aplicación utilizará el contenido guardado.'}</small></span></div>
            <div><Icon name="schedule" /><span><strong>Última descarga</strong><small>{formatDate(stats.lastDownloadAt)}</small></span></div>
            <div><Icon name="web_asset" /><span><strong>Interfaz instalada</strong><small>{stats.shellCaches ? `${stats.shellCaches} caché${stats.shellCaches === 1 ? '' : 's'} de aplicación` : 'Se guardará al instalar o abrir la PWA'}</small></span></div>
          </section>

          <section className="offline-section-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">BASE OPERATIVA</span>
                <h2>Contenido disponible</h2>
              </div>
              <span className="offline-section-panel__count">{stats.downloadedSections}/{stats.totalSections}</span>
            </div>

            <div className="offline-section-list">
              {stats.sections.map((section) => (
                <article key={section.id} className={`offline-section-row${section.available ? ' is-available' : ''}${section.stale ? ' is-stale' : ''}`}>
                  <span className="offline-section-row__icon"><Icon name={statusIcon(section)} /></span>
                  <div className="offline-section-row__content">
                    <strong>{section.label}</strong>
                    <small>{statusText(section)}{section.savedAt ? ` · ${formatDate(section.savedAt)}` : ''}</small>
                  </div>
                  <div className="offline-section-row__value">
                    <strong>{section.records.toLocaleString('es-CR')}</strong>
                    <small>registros</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="offline-section-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SINCRONIZACIÓN</span>
                <h2>Cambios pendientes de envío</h2>
              </div>
              <span className="offline-section-panel__count">{stats.pendingCount}</span>
            </div>

            {stats.pendingOperations.length ? (
              <div className="offline-pending-list">
                {stats.pendingOperations.map((operation) => (
                  <article key={operation.id} className={`offline-pending-row status-${operation.status.toLowerCase()}`}>
                    <span className="offline-section-row__icon"><Icon name={operation.status === 'ERROR' ? 'sync_problem' : 'pending_actions'} /></span>
                    <div>
                      <strong>{operation.description}</strong>
                      <small>{formatDate(operation.createdAt)} · {operation.attempts} intento{operation.attempts === 1 ? '' : 's'}</small>
                      {operation.lastError && <p>{operation.lastError}</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="offline-empty-inline"><Icon name="cloud_done" /><div><strong>No hay cambios pendientes</strong><small>Todo lo creado en este dispositivo ya fue sincronizado.</small></div></div>
            )}
          </section>

          <p className="offline-content-page__note"><Icon name="info" /> Para usar el modo offline, el técnico debe abrir la aplicación con internet al menos una vez en el mismo teléfono o computadora. Los archivos, correos, PDF y mensajes se envían cuando vuelva la conexión.</p>
        </>
      )}
    </div>
  );
}
