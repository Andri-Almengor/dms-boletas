import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import MaintenanceLocationInventory from '../../components/maintenance/MaintenanceLocationInventory';
import MaintenanceLocationPickerModal from '../../components/maintenance/MaintenanceLocationPickerModal';
import MaintenanceEvidenceEditor from '../../components/maintenance/MaintenanceEvidenceEditor';
import MaintenanceEvidenceUploader from '../../components/maintenance/MaintenanceEvidenceUploader';
import MaintenanceQuickDeviceCreator from '../../components/maintenance/MaintenanceQuickDeviceCreator';
import MaintenanceSignatureCard from '../../components/maintenance/MaintenanceSignatureCard';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

const MAINTENANCE_TICKET_TEST_ROUTES = ['maintenance.tickets.test', 'mantenimientos.boletas.probar'];
const MAINTENANCE_LOCATION_UPDATE_ROUTES = [
  'maintenance.update.locations',
  'mantenimientos.update.ubicaciones',
  'maintenance.locations.update',
  'mantenimientos.ubicaciones.actualizar',
];

function date(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'long' }).format(parsed);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedLocation(item = {}) {
  if (typeof item === 'string') return { id: item, name: item, available: true, active: true, deviceCount: 0 };
  return {
    ...item,
    id: String(pick(item, ['id', 'UbicacionEquipoID', 'ubicacionEquipoId', 'value'], '')).trim(),
    name: String(pick(item, ['name', 'nombre', 'Nombre', 'UbicacionEquipoNombre', 'label'], 'Ubicación no disponible')).trim(),
    locationId: String(pick(item, ['locationId', 'UbicacionID', 'ubicacionId'], '')).trim(),
    locationName: String(pick(item, ['locationName', 'UbicacionNombre', 'ubicacionNombre'], '')).trim(),
    description: String(pick(item, ['description', 'Descripcion', 'descripcion'], '')).trim(),
    available: item.available !== false,
    active: item.active !== false,
    legacy: Boolean(item.legacy),
    deviceCount: Number(item.deviceCount || 0),
  };
}

function locationGroups(data, row, devices) {
  const explicit = data?.ubicacionesEquipo || data?.equipmentLocations;
  const stored = Array.isArray(explicit) ? explicit : parseJsonArray(pick(row, ['UbicacionesEquipoJSON'], '[]'));
  const map = new Map(stored.map(normalizedLocation).filter((item) => item.id).map((item) => [item.id, item]));
  devices.forEach((device) => {
    const id = String(pick(device, ['UbicacionEquipoID', 'ubicacionEquipoId'], '')).trim();
    if (!id || map.has(id)) return;
    map.set(id, {
      id,
      name: String(pick(device, ['UbicacionEquipoNombre', 'Zona', 'equipmentLocationName'], 'Ubicación relacionada')).trim(),
      locationId: '',
      locationName: '',
      description: '',
      available: true,
      active: true,
      legacy: false,
      deviceCount: 0,
    });
  });
  return [...map.values()];
}

function MaintenanceMobileFold({
  id,
  title,
  subtitle,
  icon,
  badge,
  badgeClass = '',
  open,
  onToggle,
  children,
  className = '',
}) {
  return (
    <section className={`maintenance-mobile-fold${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        className="maintenance-mobile-fold__trigger"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="maintenance-mobile-fold__icon"><Icon name={icon} /></span>
        <span className="maintenance-mobile-fold__text"><strong>{title}</strong><small>{subtitle}</small></span>
        {badge && <span className={`maintenance-mobile-fold__badge ${badgeClass}`}>{badge}</span>}
        <Icon name={open ? 'expand_less' : 'expand_more'} />
      </button>
      <div className="maintenance-mobile-fold__content" id={id}>{children}</div>
    </section>
  );
}

export default function MaintenanceDetailPage() {
  const { maintenanceId } = useParams();
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();
  const isAdministrator = hasPermission('USUARIOS_GESTIONAR');
  const isAdmin = isAdministrator
    || hasPermission('MANTENIMIENTOS_ELIMINAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR');
  const canEdit = isAdmin
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_EDITAR');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [quickDeviceLocation, setQuickDeviceLocation] = useState(null);
  const [evidenceDevice, setEvidenceDevice] = useState(null);
  const [quickEvidenceOpen, setQuickEvidenceOpen] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState(null);
  const [maintenanceSigned, setMaintenanceSigned] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);

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
    window.addEventListener('dms-client-equipment-catalog-updated', refresh);
    return () => {
      window.removeEventListener('dms-offline-sync-complete', refresh);
      window.removeEventListener('dms-offline-queue-change', refresh);
      window.removeEventListener('dms-client-equipment-catalog-updated', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  const row = data?.mantenimiento || data || {};
  const devices = data?.dispositivos || data?.devices || [];
  const maintenanceLocations = useMemo(() => locationGroups(data, row, devices), [data, row, devices]);
  const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
  const pending = status === 'PENDIENTE';
  const offlinePending = Boolean(pick(row, ['OfflinePendiente'], false));
  const driveFolderUrl = pick(row, ['CarpetaDriveURL', 'MaintenanceFolderURL']);
  const generatedTicketCount = Number(pick(row, ['BoletasGeneradasCantidad'], 0) || 0);
  const signatureRegistered = maintenanceSigned || Boolean(pick(row, ['FirmaArchivoID', 'FirmaURL', 'Firma']));
  const clientName = pick(row, ['Cliente', 'ClienteRef'], 'Sin cliente');
  const displayStatus = offlinePending ? 'PENDIENTE DE SINCRONIZAR' : status;

  async function action(type) {
    if (type === 'delete' && !window.confirm('¿Eliminar este mantenimiento y todos sus dispositivos?')) return;
    if (type === 'finalize' && !window.confirm('¿Finalizar este mantenimiento? La firma general del cliente se aplicará a todas las boletas, se crearán las boletas por fecha y grupo técnico, se enviarán al supervisor y al Chat del cliente, y luego se procesarán las carpetas y evidencias del mantenimiento.')) return;
    if (type === 'test' && !window.confirm('¿Enviar una prueba completa al Chat de pruebas? No se cambiará el estado del mantenimiento.')) return;
    if (type === 'ticket-test' && !window.confirm('¿Probar la agrupación y redacción de las boletas automáticas? La vista previa se enviará al Chat de pruebas sin crear boletas ni notificar al cliente o supervisor.')) return;
    const reportWindow = ['sheet', 'slides'].includes(type) ? window.open('about:blank', '_blank') : null;
    setWorking(type);
    setError('');
    setNotice('');
    try {
      if (type === 'finalize') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId }, sessionToken);
        const delivery = result?.delivery || {};
        const count = Number(result?.ticketGeneration?.ticketCount || 0);
        const warnings = result?.ticketGeneration?.warnings || [];
        setNotice(`Mantenimiento finalizado. La firma general fue aplicada y se generaron y enviaron ${count} boleta${count === 1 ? '' : 's'} por fecha y grupo técnico. El mantenimiento también fue enviado a ${delivery.destination || 'Google Chat'}.${warnings.length ? ` Advertencias: ${warnings.join(' ')}` : ''}`);
      }
      if (type === 'test') {
        const result = await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId, testMode: true }, sessionToken);
        const delivery = result?.delivery || {};
        setNotice(`Prueba enviada correctamente a ${delivery.destination || 'el Chat de pruebas'}. El mantenimiento continúa en ${status}.`);
      }
      if (type === 'ticket-test') {
        const result = await requestAvailable(MAINTENANCE_TICKET_TEST_ROUTES, { maintenanceId }, sessionToken);
        setNotice(result?.message || `Prueba completada. Se detectaron ${result?.groupCount || 0} grupos y no se crearon boletas reales.`);
      }
      if (type === 'reopen') {
        await requestAvailable(MODULE_ROUTES.maintenance.reopen, { maintenanceId }, sessionToken);
        setNotice('Mantenimiento regresado a pendiente. Las boletas ya generadas permanecen finalizadas como registro del trabajo realizado.');
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

  function optimisticLocations(nextLocations) {
    const serialized = JSON.stringify(nextLocations.map((item) => ({
      id: item.id,
      name: item.name,
      locationId: item.locationId || '',
      locationName: item.locationName || '',
    })));
    setData((current) => ({
      ...(current || {}),
      mantenimiento: { ...(current?.mantenimiento || row), UbicacionesEquipoJSON: serialized },
      ubicacionesEquipo: nextLocations,
      equipmentLocations: nextLocations,
    }));
  }

  async function saveLocations(nextLocations, successMessage) {
    setWorking('locations');
    setError('');
    setNotice('');
    const previous = maintenanceLocations;
    optimisticLocations(nextLocations);
    try {
      const result = await requestAvailable(MAINTENANCE_LOCATION_UPDATE_ROUTES, {
        maintenanceId,
        MantenimientoID: maintenanceId,
        UbicacionesEquipoJSON: nextLocations.map((item) => ({
          id: item.id,
          name: item.name,
          locationId: item.locationId || '',
          locationName: item.locationName || '',
        })),
        ubicacionesEquipoIds: nextLocations.map((item) => item.id),
      }, sessionToken);
      if (Array.isArray(result?.ubicacionesEquipo) || Array.isArray(result?.equipmentLocations)) setData(result);
      else if (navigator.onLine !== false) await load({ silent: true });
      setNotice(successMessage);
      return true;
    } catch (saveError) {
      optimisticLocations(previous);
      setError(saveError.message || 'No se pudieron actualizar las ubicaciones del mantenimiento.');
      return false;
    } finally {
      setWorking('');
    }
  }

  async function addLocation(location) {
    if (!location?.id || maintenanceLocations.some((item) => item.id === location.id)) return false;
    const saved = await saveLocations([...maintenanceLocations, location], `La ubicación “${location.name}” fue agregada al mantenimiento.`);
    if (saved) setLocationPickerOpen(false);
    return saved;
  }

  async function removeLocation(location) {
    const used = devices.filter((device) => String(pick(device, ['UbicacionEquipoID', 'ubicacionEquipoId'], '')) === String(location.id));
    if (used.length) {
      setError(`La ubicación “${location.name}” tiene ${used.length} dispositivo${used.length === 1 ? '' : 's'}. Muévalos o elimínelos antes de quitar la ubicación.`);
      return;
    }
    if (!window.confirm(`¿Quitar la ubicación “${location.name}” de este mantenimiento? No se eliminará de la ficha del cliente.`)) return;
    await saveLocations(maintenanceLocations.filter((item) => item.id !== location.id), `La ubicación “${location.name}” fue retirada del mantenimiento.`);
  }

  function addDevice(location) {
    if (!location?.id) {
      setError('Seleccione primero una ubicación del mantenimiento.');
      return;
    }
    setError('');
    setNotice('');
    setQuickDeviceLocation(location);
  }

  function editDevice(device) {
    const id = String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
    if (!id) {
      setError('No fue posible identificar el dispositivo seleccionado.');
      return;
    }
    navigate(`/mantenimientos/${encodeURIComponent(maintenanceId)}/editar?directDevice=1&device=${encodeURIComponent(id)}`);
  }

  if (loading) return <div className="page"><div className="state-card state-card--loading"><Icon name="progress_activity" />Cargando mantenimiento...</div></div>;
  if (!data) return <div className="page"><div className="empty-state"><Icon name="error" /><h2>No se encontró el mantenimiento</h2><p>{error}</p></div></div>;

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
      {offlinePending && <div className="alert alert--warning maintenance-offline-edit-notice"><Icon name="cloud_off" /><span>Este mantenimiento está guardado en el dispositivo. Puede agregar ubicaciones, equipos y evidencias. Finalizar y generar reportes aparecerán cuando todo se sincronice.</span></div>}

      <MaintenanceMobileFold
        id="maintenance-summary-fold-content"
        title="Información del mantenimiento"
        subtitle={`${clientName} · ${maintenanceLocations.length} ubicación${maintenanceLocations.length === 1 ? '' : 'es'} · ${devices.length} dispositivo${devices.length === 1 ? '' : 's'}`}
        icon="engineering"
        badge={displayStatus}
        badgeClass={status === 'FINALIZADO' ? 'is-complete' : 'is-pending'}
        open={summaryOpen}
        onToggle={() => setSummaryOpen((value) => !value)}
      >
        <section className="maintenance-detail-summary">
          <div className="maintenance-detail-summary__hero">
            <span className="maintenance-card__icon"><Icon name="engineering" /></span>
            <div>
              <span className={`status-chip ${status === 'FINALIZADO' ? 'status-chip--active' : 'status-chip--pending'}`}>{displayStatus}</span>
              <h2>{clientName}</h2>
              <p>{pick(row, ['DescripcionGeneral'], 'Sin descripción general')}</p>
            </div>
          </div>
          <div className="maintenance-detail-summary__grid">
            <div><Icon name="calendar_month" /><span>Fecha</span><strong>{date(pick(row, ['Fecha']))}</strong></div>
            <div><Icon name="event_available" /><span>Finalización</span><strong>{date(pick(row, ['FechaFinalizacion']))}</strong></div>
            <div><Icon name="location_on" /><span>Sede principal</span><strong>{pick(row, ['Ubicacion'], 'Sin ubicación')}</strong></div>
            <div><Icon name="my_location" /><span>Ubicaciones del equipo</span><strong>{maintenanceLocations.length}</strong></div>
            <div><Icon name="groups" /><span>Responsables</span><strong>{pick(row, ['Responsables', 'Responsable'], 'Sin responsables')}</strong></div>
            <div><Icon name="devices_other" /><span>Dispositivos</span><strong>{devices.length}</strong></div>
            <div><Icon name={signatureRegistered ? 'verified' : 'draw'} /><span>Firma general</span><strong>{signatureRegistered ? 'Registrada' : 'Pendiente'}</strong></div>
            {generatedTicketCount > 0 && <div><Icon name="receipt_long" /><span>Boletas automáticas</span><strong>{generatedTicketCount}</strong></div>}
            {pick(row, ['ChatDestino']) && <div><Icon name="forum" /><span>Último destino</span><strong>{pick(row, ['ChatDestino'])}</strong></div>}
          </div>
        </section>
      </MaintenanceMobileFold>

      {!offlinePending && (
        <MaintenanceMobileFold
          id="maintenance-signature-fold-content"
          title="Firma general"
          subtitle={signatureRegistered ? 'Firma registrada para las boletas automáticas' : 'Abra para copiar o compartir el enlace con el cliente'}
          icon={signatureRegistered ? 'verified' : 'draw'}
          badge={signatureRegistered ? 'REGISTRADA' : 'PENDIENTE'}
          badgeClass={signatureRegistered ? 'is-complete' : 'is-pending'}
          open={signatureOpen}
          onToggle={() => setSignatureOpen((value) => !value)}
          className="maintenance-mobile-fold--signature"
        >
          <MaintenanceSignatureCard
            maintenanceId={maintenanceId}
            sessionToken={sessionToken}
            isAdmin={isAdmin}
            disabled={Boolean(working)}
            onStatusChange={(signed) => {
              setMaintenanceSigned(signed);
              if (signed) load({ silent: true });
            }}
          />
        </MaintenanceMobileFold>
      )}

      {(isAdmin || (pending && canEdit)) && (
        <section className="maintenance-report-actions" aria-label="Acciones del mantenimiento">
          {pending && canEdit && <button type="button" className="button button--primary" onClick={() => setLocationPickerOpen(true)} disabled={Boolean(working)}><Icon name="add_location_alt" />Agregar ubicación</button>}
          {pending && canEdit && <button type="button" className="button button--secondary maintenance-quick-evidence-button" onClick={() => setQuickEvidenceOpen(true)} disabled={!devices.length || Boolean(working)} title={devices.length ? 'Agregar evidencia a cualquier dispositivo' : 'Agregue un dispositivo primero'}><Icon name="add_a_photo" />Nueva evidencia</button>}
          {isAdmin && pending && <button type="button" className="button button--secondary" onClick={() => action('ticket-test')} disabled={Boolean(working) || offlinePending || !devices.length} title={offlinePending ? 'Sincronice el mantenimiento antes de probar las boletas' : 'Agrupar por fecha y técnicos, usar Gemini y enviar una vista previa al Chat de pruebas'}><Icon name="receipt_long" />{working === 'ticket-test' ? 'Probando boletas...' : 'Probar boletas automáticas'}</button>}
          {isAdmin && <button type="button" className="button button--secondary" onClick={() => action('test')} disabled={Boolean(working) || offlinePending || !devices.length} title={offlinePending ? 'Sincronice el mantenimiento antes de probar el envío' : 'Crear carpetas, copiar evidencias y enviar al Chat de pruebas sin finalizar'}><Icon name="science" />{working === 'test' ? 'Enviando prueba...' : 'Probar envío'}</button>}
          {isAdmin && <button type="button" className="button button--secondary" onClick={() => action('sheet')} disabled={Boolean(working) || offlinePending} title={offlinePending ? 'Sincronice el mantenimiento antes de generar el reporte' : 'Crear reporte de Excel'}><Icon name="table_view" />{working === 'sheet' ? 'Generando...' : 'Crear Excel'}</button>}
          {isAdmin && <button type="button" className="button button--secondary" onClick={() => action('slides')} disabled={Boolean(working) || offlinePending} title={offlinePending ? 'Sincronice el mantenimiento antes de generar la presentación' : 'Crear presentación'}><Icon name="slideshow" />{working === 'slides' ? 'Generando...' : 'Crear presentación'}</button>}
          {driveFolderUrl && <a className="button button--ghost" href={driveFolderUrl} target="_blank" rel="noreferrer"><Icon name="folder_open" />Abrir carpeta Drive</a>}
          {isAdmin && pick(row, ['SpreadsheetURL']) && <a className="button button--ghost" href={pick(row, ['SpreadsheetURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Excel creado</a>}
          {isAdmin && pick(row, ['SlidesURL']) && <a className="button button--ghost" href={pick(row, ['SlidesURL'])} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Presentación creada</a>}
        </section>
      )}

      <MaintenanceLocationInventory
        devices={devices}
        locations={maintenanceLocations}
        status={status}
        canEdit={canEdit}
        sessionToken={sessionToken}
        onAddLocation={() => setLocationPickerOpen(true)}
        onRemoveLocation={removeLocation}
        onAddDevice={addDevice}
        onEditDevice={editDevice}
        onAddEvidence={setEvidenceDevice}
        onEditEvidence={(image, device) => setEditingEvidence({ image, device })}
      />

      <section className="maintenance-detail-footer-actions">
        {pending && !offlinePending && isAdministrator && devices.length > 0 && <button className="button button--primary" type="button" onClick={() => action('finalize')} disabled={Boolean(working) || !signatureRegistered} title={!signatureRegistered ? 'El cliente debe firmar el mantenimiento general antes de finalizar' : 'Finalizar mantenimiento y generar boletas firmadas'}><Icon name="task_alt" />{working === 'finalize' ? 'Generando boletas y finalizando...' : signatureRegistered ? 'Finalizar mantenimiento' : 'Firma pendiente'}</button>}
        {status === 'FINALIZADO' && isAdmin && <button className="button button--secondary" type="button" onClick={() => action('reopen')} disabled={Boolean(working)}><Icon name="undo" />Volver a pendiente</button>}
        {isAdmin && <button className="button button--danger" type="button" onClick={() => action('delete')} disabled={Boolean(working)}><Icon name="delete" />Eliminar</button>}
      </section>

      <MaintenanceLocationPickerModal open={locationPickerOpen} maintenanceLocationId={String(pick(row, ['UbicacionID'], ''))} existingLocations={maintenanceLocations} saving={working === 'locations'} onClose={() => setLocationPickerOpen(false)} onSave={addLocation} />
      {quickDeviceLocation && <MaintenanceQuickDeviceCreator maintenanceId={maintenanceId} sessionToken={sessionToken} initialEquipmentLocation={quickDeviceLocation} onClose={() => setQuickDeviceLocation(null)} onCreated={() => load({ silent: true })} />}
      {evidenceDevice && <MaintenanceEvidenceUploader device={evidenceDevice} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setEvidenceDevice(null)} onUploaded={() => load({ silent: true })} />}
      {quickEvidenceOpen && <MaintenanceEvidenceUploader devices={devices} maintenanceId={maintenanceId} sessionToken={sessionToken} onClose={() => setQuickEvidenceOpen(false)} onUploaded={() => load({ silent: true })} />}
      {editingEvidence && <MaintenanceEvidenceEditor image={editingEvidence.image} device={editingEvidence.device} maintenanceId={maintenanceId} sessionToken={sessionToken} isAdmin={isAdmin} onClose={() => setEditingEvidence(null)} onUpdated={() => load({ silent: true })} />}
    </div>
  );
}
