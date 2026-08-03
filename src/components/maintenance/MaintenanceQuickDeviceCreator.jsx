import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import ProcessingOverlay from '../feedback/ProcessingOverlay';
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
import { showMaintenanceDeviceCreatedFeedback } from '../../services/maintenanceDeviceCreatedFeedback';
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

    async function mergeEquipmentOptions(locationId) {
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
    }

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
        if (!locationId) return;

        // Al abrir desde una ubicación del inventario ya tenemos el valor
        // necesario para mostrar el formulario. El resto del catálogo se carga
        // en segundo plano, sin obligar al usuario a esperar una segunda consulta.
        if (initialEquipmentLocation?.id) {
          setLoading(false);
          mergeEquipmentOptions(locationId).catch((loadError) => {
            if (active) setError(loadError.message || 'No se pudieron actualizar las demás ubicaciones del equipo.');
          });
          return;
        }

        await mergeEquipmentOptions(locationId);
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
  }, [initialEquipmentLocation, maintenanceId, sessionToken]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      let deviceId = savedDeviceId;
      let savedRecord = null;
      let offlinePending = navigator.onLine === false;

      if (!deviceId) {
        savedRecord = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceCreate,
          maintenanceDevicePayload(device, maintenanceId),
          sessionToken,
        );
        deviceId = String(pick(savedRecord, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
        if (!deviceId) throw new Error('El servidor no devolvió el identificador del dispositivo.');
        offlinePending ||= Boolean(pick(savedRecord, ['OfflinePendiente', 'offlinePending'], false));
        setSavedDeviceId(deviceId);
        setDevice((current) => ({ ...current, id: deviceId }));
      } else {
        savedRecord = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceUpdate,
          maintenanceDevicePayload({ ...device, id: deviceId }, maintenanceId),
          sessionToken,
        );
        offlinePending ||= Boolean(pick(savedRecord, ['OfflinePendiente', 'offlinePending'], false));
      }

      const pendingImages = [...(device.newImages || [])];
      for (const image of pendingImages) {
        const uploaded = await requestAvailable(
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
        offlinePending ||= Boolean(pick(uploaded, ['OfflinePendiente', 'offlinePending'], false));
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
        setDevice((current) => ({
          ...current,
          newImages: current.newImages.filter((item) => item.localId !== image.localId),
        }));
      }

      const selectedLocation = equipmentOptions.find((item) => String(item.value) === String(device.ubicacionEquipoId));
      const feedback = {
        deviceId,
        deviceName: String(device.nombre || pick(savedRecord, ['NombreDispositivo', 'nombre', 'Nombre'], '') || 'Nuevo dispositivo').trim(),
        locationId: String(device.ubicacionEquipoId || initialEquipmentLocation?.id || ''),
        locationName: String(
          device.ubicacionEquipoNombre
          || selectedLocation?.label
          || selectedLocation?.name
          || initialEquipmentLocation?.name
          || '',
        ).trim(),
        offlinePending,
      };

      await onCreated?.(feedback);
      onClose();
      showMaintenanceDeviceCreatedFeedback(feedback);
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar el dispositivo.');
    } finally {
      setSaving(false);
    }
  }

  const pendingImageCount = Number(device.newImages?.length || 0);

  return (
    <div
      className="maintenance-evidence-modal maintenance-quick-device-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo dispositivo"
      data-no-draft
      data-device-create-mode="fresh"
    >
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
      <ProcessingOverlay
        open={saving}
        title="Guardando dispositivo"
        message={pendingImageCount
          ? `Se están guardando los datos y subiendo ${pendingImageCount} evidencia${pendingImageCount === 1 ? '' : 's'}.`
          : 'Se están guardando los datos del dispositivo y actualizando el mantenimiento.'}
      />
    </div>
  );
}
