import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import MaintenanceDeviceEditor from './MaintenanceDeviceEditor';
import { MaintenanceCountsProvider } from '../../context/MaintenanceCountsContext';
import {
  hasSelectedMaintenanceCategory,
  parseMaintenanceCounts,
} from '../../config/dynamicMaintenanceTypes';
import {
  createMaintenanceDevice,
  fileToBase64,
  maintenanceDevicePayload,
} from '../../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

function equipmentOption(row) {
  const value = String(pick(row, ['UbicacionEquipoID', 'id', 'RowID']));
  const label = pick(row, ['Nombre'], value);
  return value ? { value, label, name: label, locationId: String(pick(row, ['UbicacionID'], '')) } : null;
}

function initialDevice(location) {
  const base = createMaintenanceDevice();
  if (!location?.id) return base;
  return {
    ...base,
    ubicacionEquipoId: String(location.id),
    ubicacionEquipoNombre: String(location.name || ''),
    zona: String(location.name || ''),
  };
}

export default function MaintenanceQuickDeviceCreator({
  maintenanceId,
  sessionToken,
  initialEquipmentLocation = null,
  onClose,
  onCreated,
}) {
  const [device, setDevice] = useState(() => initialDevice(initialEquipmentLocation));
  const [maintenanceCounts, setMaintenanceCounts] = useState({});
  const [equipmentOptions, setEquipmentOptions] = useState(() => initialEquipmentLocation?.id ? [{
    value: String(initialEquipmentLocation.id),
    label: String(initialEquipmentLocation.name || initialEquipmentLocation.id),
    name: String(initialEquipmentLocation.name || initialEquipmentLocation.id),
    locationId: String(initialEquipmentLocation.locationId || ''),
    locationName: String(initialEquipmentLocation.locationName || ''),
  }] : []);
  const [maintenanceLocationId, setMaintenanceLocationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [savedDeviceId, setSavedDeviceId] = useState('');
  const [error, setError] = useState('');
  const deviceRef = useRef(device);

  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  useEffect(() => {
    let active = true;

    async function loadMaintenance() {
      setLoading(true);
      setError('');
      try {
        const data = await requestAvailable(
          MODULE_ROUTES.maintenance.get,
          { maintenanceId },
          sessionToken,
        );
        if (!active) return;

        const row = data?.mantenimiento || data || {};
        const status = String(pick(row, ['Estado'], 'PENDIENTE')).toUpperCase();
        if (status !== 'PENDIENTE') {
          setBlocked(true);
          setError('Este mantenimiento ya fue finalizado y no permite agregar dispositivos.');
          return;
        }

        const counts = parseMaintenanceCounts(row);
        setMaintenanceCounts(counts);
        if (!hasSelectedMaintenanceCategory(counts)) {
          setBlocked(true);
          setError('Primero edite el mantenimiento e indique una cantidad mayor que cero para al menos un tipo de dispositivo.');
          return;
        }

        const locationId = String(pick(row, ['UbicacionID'], ''));
        setMaintenanceLocationId(locationId);
        if (!locationId) {
          setEquipmentOptions((current) => current);
          return;
        }

        const equipmentData = await requestAvailable(
          MODULE_ROUTES.clients.equipmentLocationsList,
          { ubicacionId: locationId, activo: true, page: 1, pageSize: 1000 },
          sessionToken,
        );
        if (!active) return;
        const loaded = normalizeItems(equipmentData).map(equipmentOption).filter(Boolean);
        setEquipmentOptions((current) => {
          const byId = new Map([...current, ...loaded].map((item) => [String(item.value), item]));
          return [...byId.values()];
        });
      } catch (loadError) {
        if (active) setError(loadError.message || 'No se pudo preparar el nuevo dispositivo.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadMaintenance();
    return () => {
      active = false;
      (deviceRef.current.newImages || []).forEach((image) => {
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      });
    };
  }, [maintenanceId, sessionToken]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      let deviceId = savedDeviceId;
      if (!deviceId) {
        const saved = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceCreate,
          maintenanceDevicePayload(device, maintenanceId),
          sessionToken,
        );
        deviceId = String(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
        if (!deviceId) throw new Error('El servidor no devolvió el identificador del dispositivo.');
        setSavedDeviceId(deviceId);
        setDevice((current) => ({ ...current, id: deviceId }));
      } else {
        await requestAvailable(
          MODULE_ROUTES.maintenance.deviceUpdate,
          maintenanceDevicePayload({ ...device, id: deviceId }, maintenanceId),
          sessionToken,
        );
      }

      const pendingImages = [...(device.newImages || [])];
      for (const image of pendingImages) {
        await requestAvailable(
          MODULE_ROUTES.maintenance.imageUpload,
          {
            maintenanceId,
            deviceId,
            DispositivoMantenimientoRef: deviceId,
            Tipo: image.type,
            Nota: image.note,
            fileName: image.file.name,
            mimeType: image.file.type || 'image/jpeg',
            base64: await fileToBase64(image.file),
          },
          sessionToken,
        );
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
        setDevice((current) => ({
          ...current,
          newImages: current.newImages.filter((item) => item.localId !== image.localId),
        }));
      }

      await onCreated?.();
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar el dispositivo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-evidence-modal maintenance-quick-device-modal" role="dialog" aria-modal="true" aria-label="Nuevo dispositivo">
      <div className="maintenance-evidence-modal__backdrop" onClick={saving ? undefined : onClose} />
      <section className="maintenance-evidence-modal__panel maintenance-quick-device-modal__panel">
        {loading ? (
          <div className="state-card state-card--loading"><Icon name="progress_activity" />Preparando nuevo dispositivo...</div>
        ) : blocked ? (
          <div className="empty-state">
            <Icon name="lock" />
            <h2>No se puede agregar el dispositivo</h2>
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={onClose}>Volver al detalle</button>
          </div>
        ) : (
          <>
            {initialEquipmentLocation?.id && <div className="maintenance-quick-device-location-banner"><Icon name="location_on" /><div><span>Ubicación del equipo</span><strong>{initialEquipmentLocation.name || 'Ubicación seleccionada'}</strong><small>El dispositivo se guardará dentro de este grupo. Puede cambiar la ubicación desde el formulario.</small></div></div>}
            {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
            <MaintenanceCountsProvider counts={maintenanceCounts}>
              <MaintenanceDeviceEditor
                device={device}
                equipmentOptions={equipmentOptions}
                maintenanceLocationId={maintenanceLocationId}
                disabled={saving}
                isAdmin={false}
                onChange={setDevice}
                onCancel={onClose}
                onClose={onClose}
                onSubmit={save}
                submitLabel="Guardar dispositivo"
                submitting={saving}
              />
            </MaintenanceCountsProvider>
          </>
        )}
      </section>
    </div>
  );
}
