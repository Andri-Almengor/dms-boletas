import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../AuthContext';
import MaintenanceDeviceEditor from '../components/maintenance/MaintenanceDeviceEditor';
import ProcessingOverlay from '../components/feedback/ProcessingOverlay';
import { MaintenanceCountsProvider } from '../context/MaintenanceCountsContext';
import { parseMaintenanceCounts } from '../config/dynamicMaintenanceTypes';
import { mapMaintenanceDevice } from '../pages/maintenance/maintenanceFormData';
import { persistMaintenanceDevice } from './maintenanceDevicePersistence';
import { MODULE_ROUTES, pick, requestAvailable } from './moduleApi';

export const OFFLINE_DEVICE_EDITOR_EVENT = 'dms-open-offline-maintenance-device';
const ROOT_ID = 'dms-offline-maintenance-device-editor-root';

function deviceId(row = {}) {
  return String(pick(row, ['EvidenciaMantenimientoID', 'deviceId', 'id'], '')).trim();
}

function equipmentOption(row = {}) {
  const value = String(pick(row, ['UbicacionEquipoID', 'id', 'value'], '')).trim();
  if (!value) return null;
  return {
    value,
    label: String(pick(row, ['Nombre', 'name', 'label', 'UbicacionEquipoNombre'], value)).trim() || value,
  };
}

function equipmentOptionsFrom(data, device) {
  const explicit = data?.ubicacionesEquipo || data?.equipmentLocations || [];
  const options = explicit.map(equipmentOption).filter(Boolean);
  const currentId = String(device?.ubicacionEquipoId || '').trim();
  if (currentId && !options.some((item) => item.value === currentId)) {
    options.unshift({
      value: currentId,
      label: String(device?.ubicacionEquipoNombre || device?.zona || 'Ubicación del equipo').trim(),
    });
  }
  return options;
}

function OfflineDeviceEditorSession({ request, onClose }) {
  const { sessionToken, hasPermission } = useAuth();
  const [device, setDevice] = useState(null);
  const [counts, setCounts] = useState({});
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [maintenanceLocationId, setMaintenanceLocationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR');

  useEffect(() => {
    let active = true;

    async function loadDevice() {
      setLoading(true);
      setError('');
      try {
        const data = await requestAvailable(
          MODULE_ROUTES.maintenance.get,
          { maintenanceId: request.maintenanceId },
          sessionToken,
        );
        if (!active) return;

        const row = data?.mantenimiento || data || {};
        const rawDevices = data?.dispositivos || data?.devices || [];
        const rawDevice = rawDevices.find((item) => deviceId(item) === request.deviceId)
          || request.deviceSnapshot
          || null;

        if (!rawDevice) {
          throw new Error('El dispositivo offline todavía no está disponible en la caché local. Cierre este mensaje y vuelva a intentarlo.');
        }

        const mapped = mapMaintenanceDevice(rawDevice);
        if (!mapped.id) mapped.id = request.deviceId;
        if (!mapped.localId) mapped.localId = request.deviceId;

        setDevice(mapped);
        setCounts(parseMaintenanceCounts(row));
        setMaintenanceLocationId(String(pick(row, ['UbicacionID', 'ubicacionId'], '')).trim());
        setEquipmentOptions(equipmentOptionsFrom(data, mapped));
      } catch (loadError) {
        if (active) setError(loadError.message || 'No se pudo abrir el dispositivo offline.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDevice();
    return () => { active = false; };
  }, [request, sessionToken]);

  const autosaveStatus = useMemo(
    () => (navigator.onLine === false ? 'local' : 'idle'),
    [],
  );

  async function save() {
    if (!device || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await persistMaintenanceDevice({
        maintenanceId: request.maintenanceId,
        device,
        sessionToken,
      });
      setDevice(result.snapshot);
      if (!result.complete) {
        setError(result.failureMessage || 'Algunos cambios quedaron pendientes. Puede volver a guardar sin duplicarlos.');
        return;
      }

      window.dispatchEvent(new CustomEvent('dms-offline-queue-change'));
      window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar el dispositivo offline.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="maintenance-evidence-modal maintenance-quick-device-modal maintenance-offline-device-editor-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Editar dispositivo offline"
      data-no-draft
      data-offline-device-editor
    >
      <div className="maintenance-evidence-modal__backdrop" onClick={saving ? undefined : onClose} />
      <section className="maintenance-evidence-modal__panel maintenance-quick-device-modal__panel">
        {loading && <div className="state-card state-card--loading"><span className="material-symbols-outlined">progress_activity</span>Abriendo dispositivo offline...</div>}
        {!loading && error && !device && (
          <div className="empty-state">
            <span className="material-symbols-outlined">cloud_off</span>
            <h2>No se pudo abrir el dispositivo</h2>
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={onClose}>Volver al mantenimiento</button>
          </div>
        )}
        {!loading && device && (
          <>
            {error && <div className="alert alert--error"><span className="material-symbols-outlined">error</span><span>{error}</span></div>}
            <MaintenanceCountsProvider counts={counts}>
              <MaintenanceDeviceEditor
                device={device}
                equipmentOptions={equipmentOptions}
                maintenanceLocationId={maintenanceLocationId}
                technicians={[]}
                disabled={false}
                isAdmin={isAdmin}
                onChange={setDevice}
                onCancel={onClose}
                onClose={onClose}
                onSubmit={save}
                submitLabel="Guardar cambios offline"
                submitting={saving}
                autosaveStatus={autosaveStatus}
              />
            </MaintenanceCountsProvider>
          </>
        )}
      </section>
      <ProcessingOverlay
        open={saving}
        title="Guardando dispositivo"
        message="Los cambios se guardarán en este equipo y se sincronizarán al recuperar conexión."
      />
    </div>
  );
}

function OfflineDeviceEditorHost() {
  const [request, setRequest] = useState(null);

  useEffect(() => {
    const open = (event) => {
      const maintenanceId = String(event?.detail?.maintenanceId || '').trim();
      const requestedDeviceId = String(event?.detail?.deviceId || '').trim();
      if (!maintenanceId || !requestedDeviceId) return;
      setRequest({
        maintenanceId,
        deviceId: requestedDeviceId,
        deviceSnapshot: event?.detail?.deviceSnapshot || null,
      });
    };
    window.addEventListener(OFFLINE_DEVICE_EDITOR_EVENT, open);
    return () => window.removeEventListener(OFFLINE_DEVICE_EDITOR_EVENT, open);
  }, []);

  if (!request) return null;
  return <OfflineDeviceEditorSession request={request} onClose={() => setRequest(null)} />;
}

function mountOfflineDeviceEditor() {
  if (typeof document === 'undefined') return;
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ROOT_ID;
    document.body.appendChild(host);
  }
  if (host.__dmsReactRoot) return;
  host.__dmsReactRoot = createRoot(host);
  host.__dmsReactRoot.render(
    <AuthProvider>
      <OfflineDeviceEditorHost />
    </AuthProvider>,
  );
}

if (typeof window !== 'undefined') {
  if (document.body) mountOfflineDeviceEditor();
  else window.addEventListener('DOMContentLoaded', mountOfflineDeviceEditor, { once: true });
}
