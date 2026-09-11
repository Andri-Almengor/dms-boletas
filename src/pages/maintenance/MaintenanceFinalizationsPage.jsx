import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import {
  listActiveMaintenanceFinalizations,
  stopMaintenanceFinalization,
} from '../../services/maintenanceFinalization';

function clean(value) {
  return String(value ?? '').trim();
}

function progress(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function stateLabel(row) {
  return clean(row.EstadoFinalizacion).toUpperCase() === 'PROGRAMADO'
    ? 'Programado'
    : 'Finalizando';
}

function actionLabel(row, stopping) {
  if (stopping) return 'Deteniendo...';
  return clean(row.EstadoFinalizacion).toUpperCase() === 'PROGRAMADO'
    ? 'Cancelar programación'
    : 'Detener finalización';
}

export default function MaintenanceFinalizationsPage() {
  const { sessionToken } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stoppingId, setStoppingId] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await listActiveMaintenanceFinalizations(sessionToken);
      setItems(result.items || []);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'No se pudieron consultar las finalizaciones activas.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!items.length) return undefined;
    const timer = window.setInterval(() => load({ silent: true }), 5_000);
    return () => window.clearInterval(timer);
  }, [items.length, load]);

  async function stop(row) {
    const id = clean(row.MantenimientoID);
    if (!id || stoppingId) return;
    const scheduled = clean(row.EstadoFinalizacion).toUpperCase() === 'PROGRAMADO';
    const confirmation = scheduled
      ? '¿Cancelar la finalización programada? El mantenimiento volverá a quedar disponible y no se procesará automáticamente.'
      : '¿Detener esta finalización? El paso que ya está ejecutándose puede terminar, pero no se iniciarán nuevas unidades. Todo lo ya generado se conservará.';
    if (!window.confirm(confirmation)) return;

    setStoppingId(id);
    setMessage('');
    setError('');
    try {
      const result = await stopMaintenanceFinalization({
        maintenanceId: id,
        state: row.EstadoFinalizacion,
        sessionToken,
      });
      setMessage(result?.message || 'La finalización fue detenida.');
      setItems((current) => current.filter((item) => clean(item.MantenimientoID) !== id));
      await load({ silent: true });
    } catch (stopError) {
      setError(stopError?.message || 'No se pudo detener la finalización.');
      await load({ silent: true });
    } finally {
      setStoppingId('');
    }
  }

  return <div className="page maintenance-page maintenance-finalizations-page">
    <div className="list-page-heading maintenance-heading">
      <div>
        <span className="eyebrow">Administración</span>
        <h1>Finalizaciones de mantenimiento</h1>
        <p>Revise los mantenimientos programados o en proceso y deténgalos sin perder lo ya completado.</p>
      </div>
      <button type="button" className="button button--secondary button--compact" onClick={() => load()} disabled={loading}>
        <Icon name={loading ? 'progress_activity' : 'refresh'} />Actualizar
      </button>
    </div>

    <div className="maintenance-finalizations-page__notice">
      <Icon name="info" />
      <span>Detener es cooperativo: la unidad que ya está ejecutándose puede terminar, pero el worker no iniciará una nueva. Los PDF, boletas y evidencias ya procesados se conservan.</span>
    </div>

    {message && <div className="alert alert--success"><Icon name="check_circle" /><span>{message}</span></div>}
    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    {loading ? (
      <div className="state-card state-card--loading"><Icon name="progress_activity" />Consultando finalizaciones activas...</div>
    ) : items.length ? (
      <div className="maintenance-grid maintenance-finalizations-grid">
        {items.map((row) => {
          const id = clean(row.MantenimientoID);
          const percentage = progress(row.FinalizacionProgreso);
          const scheduled = clean(row.EstadoFinalizacion).toUpperCase() === 'PROGRAMADO';
          const stopping = stoppingId === id;
          return <article className="maintenance-card maintenance-finalization-admin-card" key={id}>
            <div className="maintenance-card__top">
              <span className="maintenance-card__icon"><Icon name={scheduled ? 'schedule' : 'pending_actions'} /></span>
              <span className={`status-chip ${scheduled ? 'status-chip--pending' : 'status-chip--active'}`}>{stateLabel(row)}</span>
            </div>
            <div>
              <span className="eyebrow">{clean(row.Cliente) || 'Sin cliente'}</span>
              <h2>{clean(row.TituloMantenimiento) || id}</h2>
              <p>{clean(row.FinalizacionMensaje) || (scheduled ? 'Esperando la hora programada.' : 'Finalización en segundo plano.')}</p>
            </div>
            <div className="maintenance-finalization-admin-card__progress" aria-label={`Progreso ${percentage}%`}>
              <div><span style={{ width: `${percentage}%` }} /></div>
              <strong>{percentage}%</strong>
            </div>
            <div className="maintenance-progress-mini">
              <div><strong>{Number(row.FinalizacionBoletasCompletadas || 0)}/{Number(row.FinalizacionTotalBoletas || 0)}</strong><span>boletas</span></div>
              <div><strong>{Number(row.FinalizacionDispositivosCompletados || 0)}/{Number(row.FinalizacionTotalDispositivos || 0)}</strong><span>dispositivos</span></div>
              <div><strong>{Number(row.FinalizacionEvidenciasProcesadas || 0)}/{Number(row.FinalizacionTotalEvidencias || 0)}</strong><span>evidencias</span></div>
            </div>
            <div className="maintenance-finalization-admin-card__actions">
              <Link className="button button--secondary" to={`/mantenimientos/${encodeURIComponent(id)}`}><Icon name="visibility" />Ver mantenimiento</Link>
              <button type="button" className="button button--danger" onClick={() => stop(row)} disabled={Boolean(stoppingId)}>
                <Icon name={stopping ? 'progress_activity' : scheduled ? 'event_busy' : 'stop_circle'} />{actionLabel(row, stopping)}
              </button>
            </div>
          </article>;
        })}
      </div>
    ) : (
      <div className="empty-state">
        <Icon name="task_alt" />
        <h2>No hay finalizaciones activas</h2>
        <p>En este momento no hay mantenimientos programados ni procesándose en segundo plano.</p>
        <Link className="button button--secondary" to="/mas"><Icon name="arrow_back" />Volver a Más</Link>
      </div>
    )}
  </div>;
}
