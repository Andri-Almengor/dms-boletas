import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import MaintenanceDeviceBrowser from '../../components/maintenance/MaintenanceDeviceBrowser';
import MaintenanceEvidenceEditor from '../../components/maintenance/MaintenanceEvidenceEditor';
import MaintenanceEvidenceUploader from '../../components/maintenance/MaintenanceEvidenceUploader';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function date(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'long' }).format(parsed);
}

export default function MaintenanceDetailPage() {
  const { maintenanceId } = useParams();
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const isAdmin = hasPermission('USUARIOS_GESTIONAR') || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('BOLETAS_EDITAR');
  const canFinalize = hasPermission('MANTENIMIENTOS_FINALIZAR') || hasPermission('BOLETAS_FINALIZAR') || canEdit;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [evidenceDevice, setEvidenceDevice] = useState(null);
  const [quickEvidenceOpen, setQuickEvidenceOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState(null);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      setData(await requestAvailable(MODULE_ROUTES.maintenance.get, { maintenanceId }, sessionToken));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  useEffect(() => {
    const refreshEntity = (event) => {
      if (!event?.detail?.entityId || String(event.detail.entityId) === String(maintenanceId)) load({ silent: true });
    };
    const refreshAll = () => load({ silent: true });
    window.addEventListener('dms-offline-entity-synced', refreshEntity);
    window.addEventListener('dms-offline-sync-complete', refreshAll);
    return () => {
      window.removeEventListener('dms-offline-entity-synced', refreshEntity);
      window.removeEventListener('dms-offline-sync-complete', refreshAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  const row = data?.mantenimiento || data || {};
  const devices = data?.dispositivos || data?.devices || [];
  const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
  const offlinePending = Boolean(pick(row, ['OfflinePendiente'], false)) || Boolean(data?.offlineQueued);

  async function action(type) {
    if (type === 'delete' && !window.confirm('¿Eliminar este mantenimiento y todos sus dispositivos?')) return;
    if (type === 'finalize' && !window.confirm('¿Finalizar este mantenimiento? Después quedará en modo consulta.')) return;
    setWorking(type);
    setError('');
    try {
      if (type === 'finalize') await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId }, sessionToken);
      if (type === 'reopen') await requestAvailable(MODULE_ROUTES.maintenance.reopen, { maintenanceId }, sessionToken);
      if (type === 'delete') {
        await requestAvailable(MODULE_ROUTES.maintenance.delete, { maintenanceId }, sessionToken);
        navigate('/mantenimientos');
        return;
      }
      if (type === 'sheet') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.reportSpreadsheet, { maintenanceId }, sessionToken);
        window.open(pick(result, ['spreadsheetUrl', 'url']), '_blank', 'noopener,noreferrer');
      }
      if (type === 'slides') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.reportSlides, { maintenanceId }, sessionToken);
        window.open(pick(result, ['slidesUrl', 'url']), '_blank', 'noopener,noreferrer');
      }
      await load({ silent: true });
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking('');
    }
  }

  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;
  }

  if (!data) {
    return <div className="page"><div className="empty-state"><Icon name="error" /><h2>No se encontró el mantenimiento</h2><p>{error}</p></div></div>;
  }

  const editUrl = `/mantenimientos/${encodeURIComponent(maintenanceId)}/editar`;

  return (
    <div className="page maintenance-detail-page maintenance-detail-page--large">
      <div className="page-header knowledge-detail-header">
        <button className="icon-button" type="button" onClick={() => navigate('/mantenimientos')}><Icon name="arrow_back" /></button>
        <div><span className="eyebrow">Mantenimiento técnico</span><h1>{pick(row, ['TituloMantenimiento'], 'Mantenimiento')}</h1></div>
        {status === 'PENDIENTE' && canEdit
          ? <Link className="icon-button" to={editUrl} aria-label="Editar"><Icon name="edit" /></Link>
          : <span />}
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      {offlinePending && <div className="alert alert--warning"><Icon name="cloud_off" /><span>Este mantenimiento tiene cambios pendientes. Puede seguir editándolo; la opción de finalizar aparecerá cuando todo se sincronice.</span></div>}

      <section className="maintenance-detail-summary">
        <div className="maintenance-detail-summary__hero">
          <span className="maintenance-card__icon"><Icon name="engineering" /></span>
          <div>
            <span className={`status-chip ${status === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{offlinePending ? 'PENDIENTE DE SINCRONIZAR' : status}</span>
            <h2>{pick(row, ['Cliente', 'ClienteRef'], 'Sin cliente')}</h2>
            <p>{pick(row, ['DescripcionGeneral'], 'Sin descripción general')}</p>
          </div>
        </div>
        <div className="maintenance-detail-summary__grid">
          <div><Icon name="calendar_month" /><span>Fecha</span><strong>{date(pick(row, ['Fecha']))}</strong></div>
          <div><Icon name="event_available" /><span>Finalización</span><strong>{date(pick(row, ['FechaFinalizacion']))}</strong></div>
          <div><Icon name="location_on" /><span>Ubicación</span><strong>{pick(row, ['Ubicacion'], 'Sin ubicación')}</strong></div>
          <div><Icon name="groups" /><span>Responsables</span><strong>{pick(row, ['Responsables', 'Responsable'], 'Sin responsables')}</strong></div>
        </div>
      </section>

      {(isAdmin || (status === 'PENDIENTE' && canEdit)) && (
        <section className="maintenance-report-actions" aria-label="Acciones del mantenimiento">
          {status === 'PENDIENTE' && canEdit && (
            <Link className="button button--primary" to={`${editUrl}?newDevice=1`}><Icon name="add" />Agregar dispositivo</Link>
          )}
          {isAdmin && !offlinePending && (
            <>
              <button type="button" className="button button--secondary" onClick={() => action('sheet')} disabled={Boolean(working)}><Icon name="table_view" />{working === 'sheet' ? 'Generando...' : 'Crear Excel'}</button>
              <button type="button" className="button button--secondary" onClick={() => action('slides')} disabled={Boolean(working)}><Icon name="slideshow" />{working === 'slides' ? 'Generando...' : 'Crear presentación'}</button>
            </>
          )}
          {status === 'PENDIENTE' && canEdit && devices.length > 0 && (
            <button type="button" className="button button--secondary maintenance-quick-evidence-button" onClick={() => setQuickEvidenceOpen(true)} disabled={Boolean(working)}><Icon name="add_a_photo" />Nueva evidencia</button>
          )}
          {isAdmin && pick(row, ['SpreadsheetURL']) && <a className="button button--ghost" href={pick(row, ['SpreadsheetURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Excel creado</a>}
          {isAdmin && pick(row, ['SlidesURL']) && <a className="button button--ghost" href={pick(row, ['SlidesURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Presentación creada</a>}
        </section>
      )}

      <MaintenanceDeviceBrowser
        devices={devices}
        status={status}
        canEdit={canEdit}
        sessionToken={sessionToken}
        onAddDevice={() => navigate(`${editUrl}?newDevice=1`)}
        onAddEvidence={setEvidenceDevice}
        onEditEvidence={setEditingEvidence}
      />

      <section className="maintenance-detail-footer-actions">
        {status === 'PENDIENTE' && canFinalize && !offlinePending && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={Boolean(working)}><Icon name="task_alt" />Finalizar mantenimiento</button>}
        {status === 'FINALIZADO' && isAdmin && <button className="button button--secondary" type="button" onClick={() => action('reopen')} disabled={Boolean(working)}><Icon name="undo" />Volver a pendiente</button>}
        {isAdmin && <button className="button button--danger" type="button" onClick={() => action('delete')} disabled={Boolean(working)}><Icon name="delete" />Eliminar</button>}
      </section>

      {evidenceDevice && (
        <MaintenanceEvidenceUploader device={evidenceDevice} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setEvidenceDevice(null)} onUploaded={() => load({ silent: true })} />
      )}
      {quickEvidenceOpen && (
        <MaintenanceEvidenceUploader devices={devices} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setQuickEvidenceOpen(false)} onUploaded={() => load({ silent: true })} />
      )}
      {editingEvidence && (
        <MaintenanceEvidenceEditor image={editingEvidence.image} device={editingEvidence.device} maintenanceId={maintenanceId} sessionToken={sessionToken} isAdmin={isAdmin} onClose={() => setEditingEvidence(null)} onUpdated={() => load({ silent: true })} />
      )}
    </div>
  );
}
