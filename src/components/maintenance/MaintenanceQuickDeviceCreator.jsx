import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import ProcessingOverlay from '../feedback/ProcessingOverlay';
import MaintenanceDeviceEditor from './MaintenanceDeviceEditor';
import TechnicianMultiSelect from '../forms/TechnicianMultiSelect';
import { MaintenanceCountsProvider } from '../../context/MaintenanceCountsContext';
import {
  hasSelectedMaintenanceCategory,
  parseMaintenanceCounts,
  selectedMaintenanceCategories,
} from '../../config/dynamicMaintenanceTypes';
import {
  createMaintenanceDevice,
  maintenanceDevicePayload,
} from '../../pages/maintenance/maintenanceFormData';
import { showMaintenanceDeviceCreatedFeedback } from '../../services/maintenanceDeviceCreatedFeedback';
import { loadCatalogResource } from '../../services/catalogResource';
import { activeMaintenanceUsers, buildMaintenanceTechnicians } from '../../features/maintenance/maintenanceFormDomain';
import { MAX_BULK_MAINTENANCE_DEVICES, parseBulkMaintenanceDeviceNames } from '../../features/maintenance/maintenanceDeviceState';
import { createLocalId } from '../../utils/localId';
import {
  emptyProjectChecklist,
  normalizeProjectChecklist,
} from '../../features/maintenance/maintenanceProjectChecklist';
import { uploadMaintenanceImagesInBatches } from '../../services/maintenanceImageBatch';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import useOverlaySurface from '../../hooks/useOverlaySurface';

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

function responseIsOfflinePending(response) {
  return Boolean(pick(response, ['OfflinePendiente', 'offlinePending', 'offlineQueued'], false));
}

export default function MaintenanceQuickDeviceCreator({
  maintenanceId,
  sessionToken,
  initialEquipmentLocation = null,
  bulk = false,
  availableDeviceTypes = [],
  onClose,
  onCreated,
}) {
  const [device, setDevice] = useState(() => initialDevice(initialEquipmentLocation));
  const [maintenanceCounts, setMaintenanceCounts] = useState({});
  const [maintenanceType, setMaintenanceType] = useState('MANTENIMIENTO');
  const [projectChecklist, setProjectChecklist] = useState(() => emptyProjectChecklist());
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
  const [bulkNamesInput, setBulkNamesInput] = useState('');
  const [bulkTypeSelection, setBulkTypeSelection] = useState('');
  const [bulkLocationId, setBulkLocationId] = useState(() => String(initialEquipmentLocation?.id || ''));
  const [bulkEntries, setBulkEntries] = useState([]);
  const [bulkOfflinePending, setBulkOfflinePending] = useState(false);
  const [bulkTechnicians, setBulkTechnicians] = useState([]);
  const [bulkTechnicianIds, setBulkTechnicianIds] = useState([]);
  const [bulkTechnicianLoading, setBulkTechnicianLoading] = useState(false);
  const [bulkTechnicianError, setBulkTechnicianError] = useState('');
  const deviceRef = useRef(device);
  useOverlaySurface({ open: true, onClose, busy: saving });

  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  useEffect(() => {
    if (!bulk || !sessionToken) return undefined;
    const controller = new AbortController();
    setBulkTechnicianLoading(true);
    setBulkTechnicianError('');
    // Mismo catálogo asignable que utiliza el formulario de mantenimiento.
    // No requiere permisos de administración de usuarios.
    loadCatalogResource({
      routes: ['users.assignment.list', 'users.list'],
      payload: { page: 1, pageSize: 1000 },
      sessionToken,
      signal: controller.signal,
    }).then(({ items }) => {
      if (!controller.signal.aborted) {
        setBulkTechnicians(buildMaintenanceTechnicians(activeMaintenanceUsers(items)));
      }
    }).catch((loadError) => {
      if (!controller.signal.aborted) setBulkTechnicianError(loadError.message || 'No se pudieron cargar los técnicos.');
    }).finally(() => {
      if (!controller.signal.aborted) setBulkTechnicianLoading(false);
    });
    return () => controller.abort();
  }, [bulk, sessionToken]);

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
        const nextMaintenanceType = String(pick(row, ['TipoMantenimiento'], 'MANTENIMIENTO')).toUpperCase() === 'PROYECTO' ? 'PROYECTO' : 'MANTENIMIENTO';
        setMaintenanceType(nextMaintenanceType);
        setProjectChecklist(
          nextMaintenanceType === 'PROYECTO'
            ? normalizeProjectChecklist(pick(row, ['ProyectoChecklistJSON'], emptyProjectChecklist()))
            : emptyProjectChecklist(),
        );
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
      let offlinePending = typeof navigator !== 'undefined' && navigator.onLine === false;

      if (!deviceId) {
        savedRecord = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceCreate,
          maintenanceDevicePayload(device, maintenanceId, maintenanceType),
          sessionToken,
        );
        deviceId = String(pick(savedRecord, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
        if (!deviceId) throw new Error('El servidor no devolvió el identificador del dispositivo.');
        offlinePending ||= responseIsOfflinePending(savedRecord);
        setSavedDeviceId(deviceId);
        setDevice((current) => ({ ...current, id: deviceId }));
      } else {
        savedRecord = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceUpdate,
          maintenanceDevicePayload({ ...device, id: deviceId }, maintenanceId, maintenanceType),
          sessionToken,
        );
        offlinePending ||= responseIsOfflinePending(savedRecord);
      }

      const pendingImages = [...(device.newImages || [])];
      if (pendingImages.length) {
        const uploadResult = await uploadMaintenanceImagesInBatches({
          maintenanceId,
          deviceId,
          images: pendingImages,
          sessionToken,
        });
        const uploadedKeys = new Set((uploadResult.uploaded || []).map((row) => String(
          row.clientKey || row.FotoDispositivoID || row.id || '',
        )).filter(Boolean));
        offlinePending ||= (uploadResult.uploaded || []).some(responseIsOfflinePending);

        pendingImages.forEach((image) => {
          if (!uploadedKeys.has(String(image.localId || ''))) return;
          if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
        });
        setDevice((current) => ({
          ...current,
          newImages: (current.newImages || []).filter((item) => !uploadedKeys.has(String(item.localId || ''))),
        }));

        if (uploadResult.failed?.length) {
          const error = new Error(`El dispositivo se guardó, pero ${uploadResult.failed.length} evidencia(s) no pudieron cargarse. Las pendientes permanecen en el formulario para reintentarlas.`);
          error.code = 'MAINTENANCE_EVIDENCE_PARTIAL_UPLOAD';
          throw error;
        }
      }

      const selectedLocation = equipmentOptions.find((item) => String(item.value) === String(device.ubicacionEquipoId));
      const feedback = {
        maintenanceId: String(maintenanceId || ''),
        deviceId,
        deviceName: String(device.nombre || pick(savedRecord, ['NombreDispositivo', 'nombre', 'Nombre'], '') || 'Nuevo dispositivo').trim(),
        category: String(device.categoria || pick(savedRecord, ['Categoria', 'TipoDispositivo'], '')).trim(),
        model: String(device.modelo || pick(savedRecord, ['Modelo', 'modelo'], '')).trim(),
        serial: String(device.serie || pick(savedRecord, ['Serie', 'serie'], '')).trim(),
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

  const bulkNames = parseBulkMaintenanceDeviceNames(bulkNamesInput);
  const bulkTypes = selectedMaintenanceCategories(availableDeviceTypes, maintenanceCounts);
  const bulkSelectedType = bulkTypes.find((item) => String(item.typeId || `legacy:${item.key}`) === bulkTypeSelection)
    || (!bulkTypeSelection ? bulkTypes[0] : null);
  const bulkDoneCount = bulkEntries.filter((item) => item.done).length;
  const pendingImageCount = Number(device.newImages?.length || 0);

  async function saveBulk() {
    if (!bulkSelectedType || !bulkLocationId || !bulkNames.length || bulkNames.length > MAX_BULK_MAINTENANCE_DEVICES) return;
    const selectedLocation = equipmentOptions.find((item) => item.value === bulkLocationId);
    if (!selectedLocation) {
      setError('Seleccione una ubicación del equipo válida.');
      return;
    }

    // Conservamos los mismos IDs en cada reintento para que la creación sea idempotente
    // y para que el mecanismo offline existente encole una operación por dispositivo.
    const entries = bulkEntries.length
      ? bulkEntries.map((item) => ({ ...item }))
      : bulkNames.map((name) => ({ name, id: createLocalId('dispositivo'), done: false, offlinePending: false }));
    setBulkEntries(entries);
    setSaving(true);
    setError('');
    let current = null;
    try {
      for (const item of entries) {
        if (item.done) continue;
        current = item;
        const draft = {
          ...createMaintenanceDevice(bulkSelectedType.key, maintenanceType),
          id: item.id,
          nombre: item.name,
          tipoDispositivoId: String(bulkSelectedType.typeId || ''),
          ubicacionEquipoId: bulkLocationId,
          tecnicoIds: [...bulkTechnicianIds],
          ubicacionEquipoNombre: selectedLocation.name,
          zona: selectedLocation.name,
        };
        const result = await requestAvailable(
          MODULE_ROUTES.maintenance.deviceCreate,
          maintenanceDevicePayload(draft, maintenanceId, maintenanceType),
          sessionToken,
        );
        if (!pick(result, ['EvidenciaMantenimientoID', 'deviceId', 'id'])) {
          throw new Error('El servidor no devolvió el identificador del dispositivo.');
        }
        item.done = true;
        item.offlinePending = responseIsOfflinePending(result);
        setBulkEntries(entries.map((entry) => ({ ...entry })));
        setBulkOfflinePending(entries.some((entry) => entry.offlinePending));
      }
      await onCreated?.({
        bulk: true,
        count: entries.length,
        locationName: selectedLocation.name,
        offlinePending: entries.some((item) => item.offlinePending),
      });
      onClose();
    } catch (saveError) {
      const completed = entries.filter((item) => item.done).length;
      setError(`Se guardaron ${completed} de ${entries.length} dispositivos. ${current ? `No se pudo guardar “${current.name}”. ` : ''}${saveError.message || 'Vuelva a intentar los pendientes.'}`);
      if (completed) {
        try {
          await onCreated?.({ bulk: true, count: completed, partial: true, locationName: selectedLocation.name });
        } catch { /* El error de refresco no debe ocultar los IDs confirmados. */ }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="maintenance-evidence-modal maintenance-quick-device-modal"
      role="dialog"
      aria-modal="true"
      aria-label={bulk ? 'Agregar lista de dispositivos' : 'Nuevo dispositivo'}
      data-no-draft
      data-device-create-mode="fresh"
      data-device-create-variant={bulk ? 'bulk' : undefined}
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
        ) : bulk ? (
          <div className="maintenance-bulk-device-form">
            <header className="maintenance-bulk-device-form__header">
              <div><span className="eyebrow">MANTENIMIENTO · DISPOSITIVOS</span><h2>Agregar lista de dispositivos</h2><p>Seleccione el tipo, la ubicación y los técnicos que trabajarán en los equipos. Los demás campos quedarán pendientes para completarlos al editar cada dispositivo.</p></div>
              <button type="button" className="icon-button" aria-label="Cerrar lista de dispositivos" onClick={onClose} disabled={saving}><Icon name="close" /></button>
            </header>
            {error && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{error}</span></div>}
            <div className="maintenance-bulk-device-form__fields">
              <label className="field-group"><span className="field-label">Tipo de dispositivo</span>
                <select className="form-control" value={bulkTypeSelection || (bulkTypes[0] ? String(bulkTypes[0].typeId || `legacy:${bulkTypes[0].key}`) : '')} onChange={(event) => setBulkTypeSelection(event.target.value)} disabled={saving || bulkEntries.length > 0}>
                  {bulkTypes.map((item) => <option key={item.typeId || item.key} value={item.typeId || `legacy:${item.key}`}>{item.label || item.key}</option>)}
                </select>
              </label>
              <label className="field-group"><span className="field-label">Ubicación de los dispositivos</span>
                <select className="form-control" value={bulkLocationId} onChange={(event) => setBulkLocationId(event.target.value)} disabled={saving || bulkEntries.length > 0}>
                  <option value="">Seleccione una ubicación</option>
                  {equipmentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div className="maintenance-bulk-device-form__technicians">
                <span className="field-label">Técnicos asignados (opcional)</span>
                {bulkTechnicianLoading && <small className="field-hint">Cargando técnicos...</small>}
                {bulkTechnicianError && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{bulkTechnicianError}</span></div>}
                <TechnicianMultiSelect
                  users={bulkTechnicians}
                  selectedIds={bulkTechnicianIds}
                  onChange={setBulkTechnicianIds}
                  disabled={saving || bulkEntries.length > 0 || bulkTechnicianLoading}
                />
                <small className="field-hint">La selección se aplicará a todos los dispositivos de esta lista. Luego podrá modificar los técnicos en cada equipo.</small>
              </div>
              <label className="field-group maintenance-bulk-device-form__names"><span className="field-label">Nombres de los dispositivos</span>
                <textarea className="form-control ticket-textarea" rows="7" value={bulkNamesInput} onChange={(event) => setBulkNamesInput(event.target.value)} disabled={saving || bulkEntries.length > 0} placeholder={['Cámara uno', 'Cámara dos', 'Cámara tres'].join('\n')} />
              </label>
            </div>
            <p className="field-hint">Pegue los nombres separados por tabulación (Tab), uno debajo de otro o ambos. Se respetan los nombres y las mayúsculas que escriba; los espacios dentro del nombre se conservan.</p>
            <div className="maintenance-bulk-device-form__summary" aria-live="polite">
              <strong>{bulkEntries.length || bulkNames.length} dispositivo{(bulkEntries.length || bulkNames.length) === 1 ? '' : 's'} en la lista</strong>
              <span>{bulkDoneCount ? `${bulkDoneCount} confirmado${bulkDoneCount === 1 ? '' : 's'}${bulkOfflinePending ? ' (incluye guardados offline)' : ''}` : `Todos se crearán en estado pendiente · ${bulkTechnicianIds.length} técnico${bulkTechnicianIds.length === 1 ? '' : 's'} asignado${bulkTechnicianIds.length === 1 ? '' : 's'}.`}</span>
            </div>
            {bulkNames.length > MAX_BULK_MAINTENANCE_DEVICES && <div className="alert alert--error" role="alert">El límite por lista es de {MAX_BULK_MAINTENANCE_DEVICES} dispositivos. Divida la lista en varios grupos.</div>}
            {bulkNames.length > 0 && <div className="maintenance-bulk-device-form__preview"><strong>Vista previa</strong><div>{bulkNames.slice(0, 8).map((name, index) => <span key={index}>{name}</span>)}{bulkNames.length > 8 && <small>y {bulkNames.length - 8} más...</small>}</div></div>}
            <footer className="maintenance-bulk-device-form__actions">
              <button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>Cerrar</button>
              <button className="button button--primary" type="button" onClick={saveBulk} disabled={saving || !bulkSelectedType || !bulkLocationId || !bulkNames.length || bulkNames.length > MAX_BULK_MAINTENANCE_DEVICES || bulkDoneCount === bulkEntries.length && bulkEntries.length > 0}>
                <Icon name="playlist_add" />{bulkEntries.length ? 'Reintentar pendientes' : `Agregar ${bulkNames.length} dispositivos`}
              </button>
            </footer>
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
                maintenanceType={maintenanceType}
                projectChecklist={projectChecklist}
              />
            </MaintenanceCountsProvider>
          </>
        )}
      </section>
      <ProcessingOverlay
        open={saving}
        title={bulk ? 'Guardando lista de dispositivos' : 'Guardando dispositivo'}
        message={bulk ? `Registrando dispositivos: ${bulkDoneCount} de ${bulkEntries.length} confirmados.` : pendingImageCount
          ? `Se están guardando los datos y subiendo ${pendingImageCount} evidencia${pendingImageCount === 1 ? '' : 's'}.`
          : 'Se están guardando los datos del dispositivo y actualizando el mantenimiento.'}
      />
    </div>
  );
}
