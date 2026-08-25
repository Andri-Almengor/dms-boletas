import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import MaintenanceQuickDeviceCreator from './MaintenanceQuickDeviceCreator';
import { fileToBase64 } from '../../pages/maintenance/maintenanceFormData';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  createEvidencePreviewUrl,
  prepareEvidenceFiles,
  releaseEvidencePreviewUrl,
} from '../../utils/evidenceMedia';

function createPendingEvidence(item) {
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    file: item.file,
    type: 'Antes',
    note: '',
    mimeType: item.mimeType,
    mediaType: item.mediaType,
    durationSeconds: item.durationSeconds,
    size: item.size,
    previewUrl: createEvidencePreviewUrl(item.file),
  };
}

function EvidencePreview({ evidence }) {
  if (evidence.mediaType === 'video') {
    return <video src={evidence.previewUrl} controls preload="metadata" playsInline aria-label={evidence.file.name} />;
  }
  return <img src={evidence.previewUrl} alt={evidence.file.name} />;
}

function DeviceEvidenceUploader({ device, maintenanceId, sessionToken, onClose, onUploaded }) {
  const deviceId = String(pick(device, ['EvidenciaMantenimientoID', 'id']));
  const [evidences, setEvidences] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const evidencesRef = useRef([]);

  useEffect(() => {
    evidencesRef.current = evidences;
  }, [evidences]);

  useEffect(() => () => {
    evidencesRef.current.forEach((item) => releaseEvidencePreviewUrl(item.previewUrl));
  }, []);

  async function addFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;

    setError('');
    try {
      const prepared = await prepareEvidenceFiles(selected, { allowDocuments: false });
      setEvidences((current) => [...current, ...prepared.map(createPendingEvidence)]);
    } catch (selectionError) {
      setError(selectionError.message || 'No se pudieron preparar las evidencias seleccionadas.');
    }
  }

  function updateEvidence(localId, values) {
    setEvidences((current) => current.map((item) => item.localId === localId ? { ...item, ...values } : item));
  }

  function removeEvidence(localId) {
    setEvidences((current) => {
      const removed = current.find((item) => item.localId === localId);
      if (removed) releaseEvidencePreviewUrl(removed.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  async function upload() {
    if (!evidences.length) {
      setError('Seleccione al menos una fotografía o un video.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      for (const evidence of evidences) {
        await requestAvailable(
          MODULE_ROUTES.maintenance.imageUpload,
          {
            maintenanceId,
            deviceId,
            DispositivoMantenimientoRef: deviceId,
            Tipo: evidence.type,
            Nota: evidence.note,
            fileName: evidence.file.name,
            mimeType: evidence.mimeType,
            mediaType: evidence.mediaType,
            durationSeconds: Number(evidence.durationSeconds || 0),
            size: Number(evidence.size || evidence.file.size || 0),
            base64: await fileToBase64(evidence.file),
          },
          sessionToken,
        );
        releaseEvidencePreviewUrl(evidence.previewUrl);
        setEvidences((current) => current.filter((item) => item.localId !== evidence.localId));
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
            <span className="eyebrow">Agregar evidencias</span>
            <h2>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</h2>
            <p>{pick(device, ['Categoria'], 'Sin categoría')} · {pick(device, ['Zona'], 'Sin ubicación')}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>

        {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

        <div className="maintenance-evidence-picker">
          <label className="button button--secondary">
            <Icon name="photo_camera" /> Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={addFiles} disabled={saving} />
          </label>
          <label className="button button--secondary">
            <Icon name="videocam" /> Grabar video
            <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" capture="environment" onChange={addFiles} disabled={saving} />
          </label>
          <label className="button button--secondary">
            <Icon name="perm_media" /> Seleccionar archivos
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" multiple onChange={addFiles} disabled={saving} />
          </label>
        </div>

        <div className="info-box"><Icon name="info" /><p>Los videos deben durar máximo 1 minuto y 30 segundos y pesar hasta 17 MB.</p></div>

        <div className="maintenance-evidence-pending-grid">
          {evidences.map((evidence) => (
            <article key={evidence.localId}>
              <EvidencePreview evidence={evidence} />
              <div className="maintenance-evidence-pending-grid__fields">
                <label>
                  <span>Tipo de evidencia</span>
                  <select value={evidence.type} onChange={(event) => updateEvidence(evidence.localId, { type: event.target.value })} disabled={saving}>
                    <option value="Antes">Antes</option>
                    <option value="Despues">Después</option>
                  </select>
                </label>
                <label>
                  <span>Nota</span>
                  <input value={evidence.note} onChange={(event) => updateEvidence(evidence.localId, { note: event.target.value })} placeholder="Descripción opcional" disabled={saving} />
                </label>
                {evidence.mediaType === 'video' && <small>Video · {Math.ceil(Number(evidence.durationSeconds || 0))} segundos</small>}
              </div>
              <button className="icon-button icon-button--danger" type="button" onClick={() => removeEvidence(evidence.localId)} disabled={saving} aria-label="Quitar evidencia">
                <Icon name="delete" />
              </button>
            </article>
          ))}
          {!evidences.length && (
            <div className="maintenance-evidence-pending-empty">
              <Icon name="perm_media" />
              <strong>Agregue fotografías o videos</strong>
              <span>Podrá clasificarlos como Antes o Después.</span>
            </div>
          )}
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="button button--primary" type="button" onClick={upload} disabled={saving || !evidences.length}>
            <Icon name={saving ? 'progress_activity' : 'cloud_upload'} />
            {saving ? 'Guardando evidencias...' : `Guardar ${evidences.length || ''} evidencia${evidences.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function MaintenanceEvidenceUploader(props) {
  if (!props.device) {
    return (
      <MaintenanceQuickDeviceCreator
        maintenanceId={props.maintenanceId}
        sessionToken={props.sessionToken}
        onClose={props.onClose}
        onCreated={props.onUploaded}
      />
    );
  }

  return <DeviceEvidenceUploader {...props} />;
}