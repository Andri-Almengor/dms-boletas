import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import MaintenanceEvidenceEditor from '../../components/maintenance/MaintenanceEvidenceEditor';
import MaintenanceEvidenceUploader from '../../components/maintenance/MaintenanceEvidenceUploader';
import MaintenanceProjectDeviceDetail, {
  maintenanceDeviceId,
  maintenanceDeviceLocationName,
  maintenanceDeviceName,
  maintenanceDeviceType,
} from '../../components/maintenance/MaintenanceProjectDeviceDetail';
import { normalizeProjectChecklist } from '../../features/maintenance/maintenanceProjectChecklist';
import { isProjectMaintenance } from '../../features/maintenance/maintenanceType';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  requestSynchronizedDetail,
  subscribeSyncEntity,
} from '../../services/syncManager';

function normalizedNavigationIds(value, devices) {
  const existing = new Set(devices.map(maintenanceDeviceId).filter(Boolean));
  const requested = Array.isArray(value)
    ? value.map((id) => String(id || '').trim()).filter((id) => existing.has(id))
    : [];
  if (requested.length) return [...new Set(requested)];
  return devices.map(maintenanceDeviceId).filter(Boolean);
}

export default function MaintenanceProjectDeviceDetailPage() {
  const { maintenanceId, deviceId: rawDeviceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionToken, user, permissions, hasPermission, securityRevision } = useAuth();
  const deviceId = String(rawDeviceId || '').trim();
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
  const [error, setError] = useState('');
  const [evidenceDevice, setEvidenceDevice] = useState(null);
  const [editingEvidence, setEditingEvidence] = useState(null);

  async function load({ silent = false, forceSync = false, signal } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const payload = { maintenanceId };
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const result = offline
        ? await requestAvailable(MODULE_ROUTES.maintenance.get, payload, sessionToken, { signal })
        : await requestSynchronizedDetail(
          MODULE_ROUTES.maintenance.get,
          payload,
          sessionToken,
          {
            resource: 'maintenance',
            entityId: maintenanceId,
            userId: user?.UsuarioID,
            permissions,
            signal,
            forceSync,
          },
        );
      if (!signal?.aborted) setData(result);
    } catch (loadError) {
      if (signal?.aborted || loadError?.name === 'AbortError') return;
      setError(loadError.message || 'No se pudo cargar el proyecto.');
    } finally {
      if (!silent && !signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    const refresh = () => load({ silent: true, forceSync: navigator.onLine !== false });
    window.addEventListener('dms-offline-sync-complete', refresh);
    window.addEventListener('dms-offline-queue-change', refresh);
    window.addEventListener('dms-client-equipment-catalog-updated', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('dms-offline-sync-complete', refresh);
      window.removeEventListener('dms-offline-queue-change', refresh);
      window.removeEventListener('dms-client-equipment-catalog-updated', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken, user?.UsuarioID, permissions, securityRevision]);

  useEffect(() => subscribeSyncEntity('maintenance', maintenanceId, ({ type, data: incoming }) => {
    if (type === 'security-invalidated') {
      setData(null);
      setLoading(true);
      setError('La seguridad de la sesión cambió. Validando nuevamente sus permisos...');
      return;
    }
    if (type === 'removed') {
      setData(null);
      setLoading(false);
      setError('Este proyecto ya no está disponible.');
      return;
    }
    if ((type === 'detail' || type === 'snapshot') && incoming) {
      setData(incoming);
      setLoading(false);
      setError('');
    }
  }), [maintenanceId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [deviceId]);

  const row = data?.mantenimiento || data || {};
  const devices = data?.dispositivos || data?.devices || [];
  const projectMode = isProjectMaintenance(pick(row, ['TipoMantenimiento'], 'MANTENIMIENTO'));
  const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
  const pending = status === 'PENDIENTE';
  const projectChecklist = useMemo(
    () => normalizeProjectChecklist(pick(row, ['ProyectoChecklistJSON'], {})),
    [row.ProyectoChecklistJSON],
  );
  const activeDevice = useMemo(
    () => devices.find((device) => maintenanceDeviceId(device) === deviceId) || null,
    [devices, deviceId],
  );
  const navigationIds = useMemo(
    () => normalizedNavigationIds(location.state?.deviceIds, devices),
    [location.state?.deviceIds, devices],
  );
  const activeIndex = navigationIds.indexOf(deviceId);
  const previousId = activeIndex > 0 ? navigationIds[activeIndex - 1] : '';
  const nextId = activeIndex >= 0 && activeIndex < navigationIds.length - 1 ? navigationIds[activeIndex + 1] : '';

  function goBack() {
    if (location.state?.returnTo) {
      navigate(-1);
      return;
    }
    navigate(`/mantenimientos/${encodeURIComponent(maintenanceId)}`);
  }

  function goToDevice(nextDeviceId) {
    if (!nextDeviceId) return;
    navigate(
      `/mantenimientos/${encodeURIComponent(maintenanceId)}/dispositivos/${encodeURIComponent(nextDeviceId)}`,
      {
        replace: true,
        state: {
          ...location.state,
          deviceIds: navigationIds,
          returnTo: location.state?.returnTo || `/mantenimientos/${encodeURIComponent(maintenanceId)}`,
        },
      },
    );
  }

  function editDevice(device) {
    const id = maintenanceDeviceId(device);
    if (!id) return;
    navigate(
      `/mantenimientos/${encodeURIComponent(maintenanceId)}/editar?directDevice=1&device=${encodeURIComponent(id)}`,
      {
        state: {
          returnTo: `/mantenimientos/${encodeURIComponent(maintenanceId)}/dispositivos/${encodeURIComponent(id)}`,
        },
      },
    );
  }

  if (loading) {
    return <div className="page maintenance-project-device-detail-page"><div className="state-card state-card--loading"><Icon name="progress_activity" /><span>Cargando dispositivo...</span></div></div>;
  }

  if (!data) {
    return <div className="page maintenance-project-device-detail-page">
      <div className="page-header"><button className="icon-button" type="button" onClick={goBack}><Icon name="arrow_back" /></button><div><span className="eyebrow">Proyecto técnico</span><h1>Detalle del dispositivo</h1></div></div>
      <div className="empty-state"><Icon name="error" /><h2>No se pudo abrir el proyecto</h2><p>{error || 'No hay información disponible.'}</p></div>
    </div>;
  }

  if (!projectMode) {
    return <div className="page maintenance-project-device-detail-page">
      <div className="page-header"><button className="icon-button" type="button" onClick={goBack}><Icon name="arrow_back" /></button><div><span className="eyebrow">Mantenimiento técnico</span><h1>Detalle del dispositivo</h1></div></div>
      <div className="empty-state"><Icon name="info" /><h2>Esta vista corresponde a dispositivos de proyecto</h2><p>Abra el dispositivo desde el detalle del mantenimiento.</p><button type="button" className="button button--primary" onClick={goBack}>Volver al mantenimiento</button></div>
    </div>;
  }

  if (!activeDevice) {
    return <div className="page maintenance-project-device-detail-page">
      <div className="page-header"><button className="icon-button" type="button" onClick={goBack}><Icon name="arrow_back" /></button><div><span className="eyebrow">Proyecto técnico</span><h1>Dispositivo no disponible</h1></div></div>
      <div className="empty-state"><Icon name="devices_other" /><h2>No se encontró este dispositivo</h2><p>Puede haber sido eliminado, movido o todavía no estar disponible en la caché local.</p><button type="button" className="button button--primary" onClick={goBack}>Volver al proyecto</button></div>
    </div>;
  }

  const projectTitle = pick(row, ['TituloMantenimiento'], 'Proyecto');
  const positionText = activeIndex >= 0 ? `${activeIndex + 1} de ${navigationIds.length}` : 'Dispositivo del proyecto';

  return <div className="page maintenance-project-device-detail-page">
    <header className="maintenance-project-device-route-header">
      <button className="icon-button maintenance-project-device-route-header__back" type="button" onClick={goBack} aria-label="Volver al proyecto"><Icon name="arrow_back" /></button>
      <span className="maintenance-project-device-route-header__icon"><Icon name="devices_other" /></span>
      <div className="maintenance-project-device-route-header__identity">
        <span className="eyebrow">{projectTitle}</span>
        <h1>{maintenanceDeviceName(activeDevice)}</h1>
        <p>{maintenanceDeviceType(activeDevice)} · {maintenanceDeviceLocationName(activeDevice)} · {positionText}</p>
      </div>
      {pending && canEdit && <button className="button button--secondary button--compact maintenance-project-device-route-header__edit" type="button" onClick={() => editDevice(activeDevice)}><Icon name="edit" />Editar</button>}
    </header>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    <nav className="maintenance-project-device-route-navigation" aria-label="Navegación entre dispositivos">
      <button className="button button--secondary" type="button" onClick={() => goToDevice(previousId)} disabled={!previousId}><Icon name="arrow_back" /><span>Anterior</span></button>
      <div><span>Dispositivo</span><strong>{positionText}</strong></div>
      <button className="button button--secondary" type="button" onClick={() => goToDevice(nextId)} disabled={!nextId}><span>Siguiente</span><Icon name="arrow_forward" /></button>
    </nav>

    <MaintenanceProjectDeviceDetail
      device={activeDevice}
      projectChecklist={projectChecklist}
      sessionToken={sessionToken}
      pending={pending}
      canEdit={canEdit}
      evidenceEnabled
      onEditDevice={editDevice}
      onAddEvidence={setEvidenceDevice}
      onEditEvidence={(image, device) => setEditingEvidence({ image, device })}
    />

    <nav className="maintenance-project-device-route-navigation maintenance-project-device-route-navigation--bottom" aria-label="Continuar entre dispositivos">
      <button className="button button--secondary" type="button" onClick={() => goToDevice(previousId)} disabled={!previousId}><Icon name="arrow_back" /><span>Anterior</span></button>
      <button className="button button--primary" type="button" onClick={goBack}><Icon name="list" />Volver a dispositivos</button>
      <button className="button button--secondary" type="button" onClick={() => goToDevice(nextId)} disabled={!nextId}><span>Siguiente</span><Icon name="arrow_forward" /></button>
    </nav>

    {evidenceDevice && <MaintenanceEvidenceUploader
      device={evidenceDevice}
      maintenanceId={maintenanceId}
      sessionToken={sessionToken}
      projectMode
      onClose={() => setEvidenceDevice(null)}
      onUploaded={() => load({ silent: true, forceSync: navigator.onLine !== false })}
    />}
    {editingEvidence && <MaintenanceEvidenceEditor
      image={editingEvidence.image}
      device={editingEvidence.device}
      maintenanceId={maintenanceId}
      sessionToken={sessionToken}
      isAdmin={isAdmin}
      projectMode
      onClose={() => setEditingEvidence(null)}
      onUpdated={() => load({ silent: true, forceSync: navigator.onLine !== false })}
    />}
  </div>;
}
