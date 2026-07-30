import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useOptimizedMaintenanceBase from './useOptimizedMaintenanceBase';
import {
  maintenanceDevicePayload,
  maintenancePayload,
} from '../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../services/moduleApi';
import {
  updateMaintenanceImagesInBatches,
  uploadMaintenanceImagesInBatches,
} from '../services/maintenanceImageBatch';
import { cloneMaintenanceDevice } from '../features/maintenance/maintenanceDeviceState';
import { createLocalId } from '../utils/localId';

function clean(value) {
  return String(value ?? '').trim();
}

function uploadedImageView(row = {}) {
  return {
    ...row,
    id: clean(pick(row, ['FotoDispositivoID', 'id'])),
    dirty: false,
  };
}

function releaseUploadedPreviews(images = [], uploadedKeys = new Set()) {
  for (const image of images) {
    if (!uploadedKeys.has(clean(image.localId))) continue;
    if (image?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
    if (image?.file) {
      window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
        detail: { route: `${window.location.pathname}${window.location.search || ''}`, file: image.file },
      }));
    }
  }
}

function failureText(device, metadataFailed = [], uploadFailed = []) {
  const parts = [];
  if (metadataFailed.length) parts.push(`${metadataFailed.length} cambio${metadataFailed.length === 1 ? '' : 's'} de evidencia`);
  if (uploadFailed.length) parts.push(`${uploadFailed.length} fotografía${uploadFailed.length === 1 ? '' : 's'}`);
  return `El dispositivo “${device.nombre || device.NombreDispositivo || 'sin nombre'}” se guardó parcialmente. No se pudieron guardar ${parts.join(' y ')}. Los elementos pendientes permanecen en el formulario para reintentarlos.`;
}

function idempotentDevice(device) {
  const id = clean(device?.id || device?.localId) || createLocalId('dispositivo');
  return { ...device, id, localId: clean(device?.localId, id) };
}

export default function useScalableMaintenanceForm({ editing, maintenanceId }) {
  const navigate = useNavigate();
  const base = useOptimizedMaintenanceBase({ editing, maintenanceId });
  const [batchSaving, setBatchSaving] = useState(false);
  const savePromiseRef = useRef(null);
  const newMaintenanceIdRef = useRef(clean(maintenanceId) || createLocalId('mantenimiento'));

  const saveDeviceToServer = useCallback(async (device, { closeAfter = false } = {}) => {
    if (!device) return null;
    if (!editing || !maintenanceId) return base.commitActiveDevice(device, { closeAfter });
    if (savePromiseRef.current) return savePromiseRef.current;

    const task = (async () => {
      setBatchSaving(true);
      base.setError('');
      try {
        const requestDevice = idempotentDevice(device);
        const route = device.id ? MODULE_ROUTES.maintenance.deviceUpdate : MODULE_ROUTES.maintenance.deviceCreate;
        const saved = await requestAvailable(route, maintenanceDevicePayload(requestDevice, maintenanceId), base.sessionToken);
        const deviceId = clean(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], requestDevice.id));
        if (!deviceId) throw new Error('El backend no devolvió el identificador del dispositivo.');

        const metadataResult = await updateMaintenanceImagesInBatches({
          maintenanceId,
          deviceId,
          images: device.images || [],
          sessionToken: base.sessionToken,
        });
        const uploadResult = await uploadMaintenanceImagesInBatches({
          maintenanceId,
          deviceId,
          images: device.newImages || [],
          sessionToken: base.sessionToken,
        });

        const updatedIds = new Set((metadataResult.updatedIds || []).map(clean));
        const metadataFailedIds = new Set((metadataResult.failed || []).map((item) => clean(item.imageId)));
        const uploadedKeys = new Set((uploadResult.uploaded || []).map((item) => clean(item.clientKey || item.FotoDispositivoID)));
        const failedUploadKeys = new Set((uploadResult.failed || []).map((item) => clean(item.clientKey || item.imageId)));
        releaseUploadedPreviews(device.newImages || [], uploadedKeys);

        const snapshot = {
          ...cloneMaintenanceDevice(device),
          id: deviceId,
          images: [
            ...(device.images || []).map((image) => ({
              ...image,
              dirty: metadataFailedIds.has(clean(image.id))
                ? true
                : (updatedIds.has(clean(image.id)) ? false : image.dirty),
            })),
            ...(uploadResult.uploaded || []).map(uploadedImageView),
          ],
          newImages: (device.newImages || []).filter((image) => failedUploadKeys.has(clean(image.localId))),
        };

        if ((metadataResult.failed || []).length || (uploadResult.failed || []).length) {
          base.saveActiveDevice(snapshot);
          base.setActiveDevice(snapshot);
          base.setError(failureText(device, metadataResult.failed, uploadResult.failed));
          return null;
        }

        return base.markDeviceSaved(snapshot, { closeAfter, status: 'server' });
      } catch (error) {
        base.setError(error.message);
        return null;
      } finally {
        setBatchSaving(false);
        savePromiseRef.current = null;
      }
    })();

    savePromiseRef.current = task;
    return task;
  }, [base, editing, maintenanceId]);

  const closeActiveDevice = useCallback(() => (
    saveDeviceToServer(base.activeDevice, { closeAfter: true })
  ), [base.activeDevice, saveDeviceToServer]);

  const saveAndAddAnotherDevice = useCallback(async () => {
    const saved = await saveDeviceToServer(base.activeDevice, { closeAfter: false });
    if (saved) base.openDevice(base.createDevice());
    return saved;
  }, [base, saveDeviceToServer]);

  const persist = useCallback(async (action) => {
    if (editing) return base.persist(action);
    if (!base.form.titulo.trim()) { base.setError('El título es obligatorio.'); return null; }
    if (!base.form.clienteId) { base.setError('Selecciona un cliente.'); return null; }
    if (!base.form.responsables.length) { base.setError('Selecciona al menos un responsable.'); return null; }

    setBatchSaving(true);
    base.setError('');
    const requestedMaintenanceId = newMaintenanceIdRef.current;
    try {
      const created = await requestAvailable(
        MODULE_ROUTES.maintenance.create,
        maintenancePayload(base.form, requestedMaintenanceId),
        base.sessionToken,
      );
      const id = clean(pick(created?.mantenimiento || created, ['MantenimientoID', 'maintenanceId', 'id'], requestedMaintenanceId));
      if (!id) throw new Error('El backend no devolvió MantenimientoID.');

      for (const originalDevice of base.devices) {
        const device = idempotentDevice(originalDevice);
        const saved = await requestAvailable(
          originalDevice.id ? MODULE_ROUTES.maintenance.deviceUpdate : MODULE_ROUTES.maintenance.deviceCreate,
          maintenanceDevicePayload(device, id),
          base.sessionToken,
        );
        const deviceId = clean(pick(saved, ['EvidenciaMantenimientoID', 'deviceId', 'id'], device.id));
        if (!deviceId) throw new Error(`No se obtuvo el identificador del dispositivo “${device.nombre || 'sin nombre'}”.`);

        const metadataResult = await updateMaintenanceImagesInBatches({
          maintenanceId: id,
          deviceId,
          images: device.images || [],
          sessionToken: base.sessionToken,
        });
        const uploadResult = await uploadMaintenanceImagesInBatches({
          maintenanceId: id,
          deviceId,
          images: device.newImages || [],
          sessionToken: base.sessionToken,
        });
        if ((metadataResult.failed || []).length || (uploadResult.failed || []).length) {
          throw new Error(failureText(device, metadataResult.failed, uploadResult.failed));
        }
      }

      if (action === 'finalize') {
        await requestAvailable(MODULE_ROUTES.maintenance.finalize, { maintenanceId: id }, base.sessionToken);
      }
      base.clearDeviceDraft();
      navigate(`/mantenimientos/${encodeURIComponent(id)}`);
      return created;
    } catch (error) {
      base.setError(`${error.message} Puede volver a guardar: el mantenimiento, los dispositivos y las evidencias ya procesadas conservarán sus mismos identificadores y no se duplicarán.`);
      return null;
    } finally {
      setBatchSaving(false);
    }
  }, [base, editing, navigate]);

  return {
    ...base,
    saving: base.saving || batchSaving,
    deviceSaving: base.deviceSaving || batchSaving,
    deviceAutosaveStatus: batchSaving ? 'saving' : base.deviceAutosaveStatus,
    closeActiveDevice,
    saveAndAddAnotherDevice,
    persist,
  };
}
