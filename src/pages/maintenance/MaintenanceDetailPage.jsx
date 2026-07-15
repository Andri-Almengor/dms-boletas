import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import MaintenanceDeviceInventory from '../../components/maintenance/MaintenanceDeviceInventory';
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
  const isAdmin = hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR');
  const canEdit = hasPermission('MANTENIMIENTOS_EDITAR') || hasPermission('BOLETAS_EDITAR');
  const canFinalize = hasPermission('MANTENIMIENTOS_FINALIZAR') || hasPermission('BOLETAS_FINALIZAR') || canEdit;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
    const refresh = () => load({ silent: true });
    window.addEventListener('dms-offline-sync-complete', refresh);
    window.addEventListener('dms-offline-queue-change', refresh);
    return () => {
      window.removeEventListener('dms-offline-sync-complete', refresh);
      window.removeEventListener('dms-offline-queue-change', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  const row = data?.mantenimiento || data || {};
  const devices = data?.dispositivos || data?.devices || [];
  const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
  const pending = status === 'PENDIENTE';
  const offlinePending = Boolean(pick(row, ['OfflinePendiente'], false));

  async function action(type) {
    if (type === 'delete' && !window.confirm('¿Eliminar este mantenimiento y todos sus dispositivos?')) return;
    if (type === 'finalize' && !window.confirm('¿Finalizar este mantenimiento? Después quedará en modo consulta.')) return;
    const reportWindow = ['sheet', 'slides'].includes(type) ? window.open('about:blank', '_blank') : null;
    setWorking(type);
    setError('');
    setNotice('');
    try {
      if (type === 'finalize') {
        await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId }, sessionToken);
        setNotice('Mantenimiento finalizado correctamente.');
      }
      if (type === 'reopen') {
        await requestAvailable(MODULE_ROUTES.maintenance.reopen, { maintenanceId }, sessionToken);
        setNotice('Mantenimiento regresado a pendiente.');
      }
      if (type === 'delete') {
        await requestAvailable(MODULE_ROUTES.maintenance.delete, { maintenanceId }, sessionToken);
        navigate('/mantenimientos');
        return;
      }
      if (type === 'sheet') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.spreadsheetReport, { maintenanceId }, sessionToken);
        const url = pick(result, ['excelUrl', 'spreadsheetUrl', 'url']);
        if (!url) throw new Error('El servidor no devolvió el enlace del reporte de Excel.');
        if (reportWindow) reportWindow.location.replace(url);
        else setNotice('El reporte fue creado. Use el enlace “Excel creado” para abrirlo.');
      }
      if (type === 'slides') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.slidesReport, { maintenanceId }, sessionToken);
        const url = pick(result, ['slidesUrl', 'url']);
        if (!url) throw new Error('El servidor no devolvió el enlace de la presentación.');
        if (reportWindow) reportWindow.location.replace(url);
        else setNotice('La presentación fue creada. Use el enlace “Presentación creada” para abrirla.');
      }
      await load({ silent: true });
    } catch (actionError) {
      try { reportWindow?.close(); } catch { /* sin acción */ }
      setError(actionError.message);
    } finally {
      setWorking('');
    }
  }

  function addDevice() {
    navigate(`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar?step=devices`);
  }

  function editDevice(device) {
    const id = String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
    if (!id) {
      setError('No fue posible identificar el dispositivo seleccionado.');
      return;
    }
    navigate(`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar?step=devices&device=${encodeURIComponent(id)}`);
  }

  if (loading) {
    return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;
  }

  if (!data) {
    return <div className="page"><div className="empty-state"><Icon name="error" /><h2>No se encontró el mantenimiento</h2><p>{error}</p></div></div>;
  }

  return (
    <div className="page maintenance-detail-page maintenance-detail-page--inventory">
      <div className="page-header knowledge-detail-header">
        <button className="icon-button" type="button" onClick={() => navigate('/mantenimientos')}><Icon name="arrow_back" /></button>
        <div><span className="eyebrow">Mantenimiento técnico</span><h1>{pick(row, ['TituloMantenimiento'], 'Mantenimiento')}</h1></div>
        {pending && canEdit
          ? <Link className="icon-button" to={`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar`} aria-label="Editar"><Icon name="edit" /></Link>
          : <span />}
      </div>

      {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
      {notice && <div className="alert alert--success"><Icon name="check_circle" /><span>{notice}</span></div>}
      {offlinePending && <div className="alert alert--warning maintenance-offline-edit-notice"><Icon name="cloud_off" /><span>Este mantenimiento está guardado en el dispositivo. Puede editarlo, agregar equipos y evidencias. Finalizar y generar reportes aparecerán cuando todo se sincronice.</span></div>}

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
          <div><Icon name="devices_other" /><span>Dispositivos</span><strong>{devices.length}</strong></div>
        </div>
      </section>

      {(isAdmin || (pending && canEdit)) && (
        <section className="maintenance-report-actions" aria-label="Acciones del mantenimiento">
          {pending && canEdit && <button type="button" className="button button--primary" onClick={addDevice} disabled={Boolean(working)}><Icon name="add" />Agregar dispositivo</button>}
          {pending && canEdit && <button type="button" className="button button--secondary maintenance-quick-evidence-button" onClick={() => setQuickEvidenceOpen(true)} disabled={!devices.length || Boolean(working)} title={devices.length ? 'Agregar evidencia a cualquier dispositivo' : 'Agregue un dispositivo primero'}><Icon name="add_a_photo" />Nueva evidencia</button>}
          {isAdmin && <button type="button" className="button button--secondary" onClick={() => action('sheet')} disabled={Boolean(working) || offlinePending} title={offlinePending ? 'Sincronice el mantenimiento antes de generar el reporte' : 'Crear reporte de Excel'}><Icon name="table_view" />{working === 'sheet' ? 'Generando...' : 'Crear Excel'}</button>}
          {isAdmin && <button type="button" className="button button--secondary" onClick={() => action('slides')} disabled={Boolean(working) || offlinePending} title={offlinePending ? 'Sincronice el mantenimiento antes de generar la presentación' : 'Crear presentación'}><Icon name="slideshow" />{working === 'slides' ? 'Generando...' : 'Crear presentación'}</button>}
          {isAdmin && pick(row, ['SpreadsheetURL']) && <a className="button button--ghost" href={pick(row, ['SpreadsheetURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Excel creado</a>}
          {isAdmin && pick(row, ['SlidesURL']) && <a className="button button--ghost" href={pick(row, ['SlidesURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Presentación creada</a>}
        </section>
      )}

      <MaintenanceDeviceInventory
        devices={devices}
        status={status}
        canEdit={canEdit}
        sessionToken={sessionToken}
        onAddDevice={addDevice}
        onEditDevice={editDevice}
        onAddEvidence={setEvidenceDevice}
        onEditEvidence={(image, device) => setEditingEvidence({ image, device })}
      />

      <section className="maintenance-detail-footer-actions">
        {pending && !offlinePending && canFinalize && devices.length > 0 && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={Boolean(working)}><Icon name="task_alt" />{working === 'finalize' ? 'Finalizando...' : 'Finalizar mantenimiento'}</button>}
        {status === 'FINALIZADO' && isAdmin && <button className="button button--secondary" type="button" onClick={() => action('reopen')} disabled={Boolean(working)}><Icon name="undo" />Volver a pendiente</button>}
        {isAdmin && <button className="button button--danger" type="button" onClick={() => action('delete')} disabled={Boolean(working)}><Icon name="delete" />Eliminar</button>}
      </section>

      {evidenceDevice && <MaintenanceEvidenceUploader device={evidenceDevice} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setEvidenceDevice(null)} onUploaded={() => load({ silent: true })} />}
      {quickEvidenceOpen && <MaintenanceEvidenceUploader devices={devices} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setQuickEvidenceOpen(false)} onUploaded={() => load({ silent: true })} />}
      {editingEvidence && <MaintenanceEvidenceEditor image={editingEvidence.image} device={editingEvidence.device} maintenanceId={maintenanceId} sessionToken={sessionToken} isAdmin={isAdmin} onClose={() => setEditingEvidence(null)} onUpdated={() => load({ silent: true })} />}
    </div>
  );
}
