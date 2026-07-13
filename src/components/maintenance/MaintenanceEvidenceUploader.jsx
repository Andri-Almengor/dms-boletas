import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { fileToBase64 } from '../../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function createPendingImage(file) {
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    file,
    type: 'Antes',
    note: '',
    previewUrl: URL.createObjectURL(file),
  };
}

function getDeviceId(device) {
  return String(pick(device, ['EvidenciaMantenimientoID', 'id']));
}

export default function MaintenanceEvidenceUploader({
  device,
  devices = [],
  maintenanceId,
  sessionToken,
  onClose,
  onUploaded,
}) {
  const fixedDeviceId = device ? getDeviceId(device) : '';
  const availableDevices = useMemo(() => {
    const source = device ? [device, ...devices] : devices;
    const seen = new Set();
    return source.filter((item) => {
      const id = getDeviceId(item);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [device, devices]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(fixedDeviceId);
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imagesRef = useRef([]);

  const selectedDevice = useMemo(
    () => availableDevices.find((item) => getDeviceId(item) === selectedDeviceId) || null,
    [availableDevices, selectedDeviceId],
  );
  const groupedDevices = useMemo(() => availableDevices.reduce((map, item) => {
    const category = pick(item, ['Categoria'], 'Sin categoría');
    if (!map[category]) map[category] = [];
    map[category].push(item);
    return map;
  }, {}), [availableDevices]);

  useEffect(() => {
    if (fixedDeviceId) setSelectedDeviceId(fixedDeviceId);
  }, [fixedDeviceId]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  function addFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';

    if (!selectedDeviceId) {
      setError('Seleccione el dispositivo al que pertenecen las evidencias.');
      return;
    }

    const invalid = selected.find((file) => !String(file.type).startsWith('image/') || file.size > MAX_IMAGE_BYTES);
    if (invalid) {
      setError(invalid.size > MAX_IMAGE_BYTES
        ? `La imagen ${invalid.name} supera el límite de 15 MB.`
        : `El archivo ${invalid.name} no es una imagen válida.`);
      return;
    }

    setError('');
    setImages((current) => [...current, ...selected.map(createPendingImage)]);
  }

  function updateImage(localId, values) {
    setImages((current) => current.map((image) => image.localId === localId ? { ...image, ...values } : image));
  }

  function removeImage(localId) {
    setImages((current) => {
      const removed = current.find((image) => image.localId === localId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.localId !== localId);
    });
  }

  async function upload() {
    if (!selectedDeviceId) {
      setError('Seleccione el dispositivo al que pertenecen las evidencias.');
      return;
    }
    if (!images.length) {
      setError('Seleccione al menos una fotografía.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      for (const image of images) {
        await requestAvailable(
          MODULE_ROUTES.maintenance.imageUpload,
          {
            maintenanceId,
            deviceId: selectedDeviceId,
            DispositivoMantenimientoRef: selectedDeviceId,
            Tipo: image.type,
            Nota: image.note,
            fileName: image.file.name,
            mimeType: image.file.type || 'image/jpeg',
            base64: await fileToBase64(image.file),
          },
          sessionToken,
        );
        URL.revokeObjectURL(image.previewUrl);
        setImages((current) => current.filter((item) => item.localId !== image.localId));
      }
      await onUploaded?.();
      onClose();
    } catch (uploadError) {
      setError(uploadError.message || 'No se pudieron guardar las evidencias.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-evidence-modal" role="dialog" aria-modal="true" aria-label="Agregar evidencias">
      <div className="maintenance-evidence-modal__backdrop" onClick={saving ? undefined : onClose} />
      <section className="maintenance-evidence-modal__panel">
        <header>
          <div>
            <span className="eyebrow">Nueva evidencia</span>
            <h2>{selectedDevice ? pick(selectedDevice, ['NombreDispositivo'], 'Dispositivo') : 'Seleccione un dispositivo'}</h2>
            <p>{selectedDevice
              ? `${pick(selectedDevice, ['Categoria'], 'Sin categoría')} · ${pick(selectedDevice, ['Zona'], 'Sin ubicación')}`
              : 'La evidencia quedará relacionada únicamente con el dispositivo elegido.'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>

        {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

        {!fixedDeviceId && (
          <label className="field-group maintenance-evidence-device-select">
            <span className="field-label">Dispositivo y categoría *</span>
            <select
              className="form-control"
              value={selectedDeviceId}
              onChange={(event) => {
                setSelectedDeviceId(event.target.value);
                setError('');
              }}
              disabled={saving}
            >
              <option value="">Seleccione una opción</option>
              {Object.entries(groupedDevices).map(([category, rows]) => (
                <optgroup label={category} key={category}>
                  {rows.map((item) => {
                    const id = getDeviceId(item);
                    return <option value={id} key={id}>{pick(item, ['NombreDispositivo'], 'Dispositivo')} · {pick(item, ['Zona'], 'Sin ubicación')}</option>;
                  })}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <div className="maintenance-evidence-picker">
          <label className="button button--secondary">
            <Icon name="photo_camera" /> Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={addFiles} disabled={saving || !selectedDeviceId} />
          </label>
          <label className="button button--secondary">
            <Icon name="photo_library" /> Seleccionar imágenes
            <input type="file" accept="image/*" multiple onChange={addFiles} disabled={saving || !selectedDeviceId} />
          </label>
        </div>

        <div className="maintenance-evidence-pending-grid">
          {images.map((image) => (
            <article key={image.localId}>
              <img src={image.previewUrl} alt={image.file.name} />
              <div className="maintenance-evidence-pending-grid__fields">
                <label>
                  <span>Tipo</span>
                  <select value={image.type} onChange={(event) => updateImage(image.localId, { type: event.target.value })} disabled={saving}>
                    <option>Antes</option>
                    <option>Despues</option>
                  </select>
                </label>
                <label>
                  <span>Nota</span>
                  <input value={image.note} onChange={(event) => updateImage(image.localId, { note: event.target.value })} placeholder="Descripción opcional" disabled={saving} />
                </label>
              </div>
              <button className="icon-button icon-button--danger" type="button" onClick={() => removeImage(image.localId)} disabled={saving} aria-label="Quitar imagen">
                <Icon name="delete" />
              </button>
            </article>
          ))}
          {!images.length && (
            <div className="maintenance-evidence-pending-empty">
              <Icon name="add_a_photo" />
              <strong>Agregue fotografías</strong>
              <span>{selectedDeviceId ? 'Podrá clasificarlas como Antes o Después.' : 'Primero seleccione un dispositivo.'}</span>
            </div>
          )}
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="button button--primary" type="button" onClick={upload} disabled={saving || !selectedDeviceId || !images.length}>
            <Icon name={saving ? 'progress_activity' : 'cloud_upload'} />
            {saving ? 'Guardando evidencias...' : `Guardar ${images.length || ''} evidencia${images.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
