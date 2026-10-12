import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { useAuth } from '../../AuthContext';
import {
  getOfflineMedia,
  listOfflineMediaByEntityId,
  removeOfflineMedia,
  saveOfflineMedia,
  updateOfflineMedia,
} from '../../services/offlineMediaStore';
import MaintenanceQuickDeviceCreator from './MaintenanceQuickDeviceCreator';
import useOverlaySurface from '../../hooks/useOverlaySurface';
import { pick } from '../../services/moduleApi';
import { uploadMaintenanceImagesInBatches } from '../../services/maintenanceImageBatch';
import {
  createEvidencePreviewUrl,
  prepareEvidenceFiles,
  releaseEvidencePreviewUrl,
} from '../../utils/evidenceMedia';
import {
  projectEvidenceTargetPatch,
  projectEvidenceTargets,
} from '../../features/maintenance/maintenanceProjectRelations';

function createPendingEvidence(item, { projectMode = false, target = null } = {}) {
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    file: item.file,
    type: projectMode ? 'Proyecto' : 'Antes',
    note: '',
    capturedAt: new Date().toISOString(),
    ...(projectMode ? projectEvidenceTargetPatch(target || {}) : {}),
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

function DeviceEvidenceUploader({ device, maintenanceId, sessionToken, onClose, onUploaded, projectMode = false }) {
  const deviceId = String(pick(device, ['EvidenciaMantenimientoID', 'id']));
  const [evidences, setEvidences] = useState([]);
  const { user } = useAuth();
  const userId = String(user?.UsuarioID || '');
  const draftScope = userId && maintenanceId && deviceId
    ? `maintenance-evidence-draft:${userId}:${maintenanceId}:${deviceId}`
    : '';
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [draftWarning, setDraftWarning] = useState('');
  const [error, setError] = useState('');
  useOverlaySurface({ open: true, onClose, busy: saving || preparing });
  const targets = projectMode ? projectEvidenceTargets(device) : [];
  const defaultTarget = targets[0] || null;
  const evidencesRef = useRef([]);
  const draftWriteQueueRef = useRef(Promise.resolve());

  function queueDraftWrite(task) {
    const next = draftWriteQueueRef.current.catch(() => {}).then(task);
    draftWriteQueueRef.current = next.catch(() => {});
    return next;
  }

  useEffect(() => {
    let active = true;
    setRestoring(true);
    if (!draftScope) {
      setRestoring(false);
      return () => { active = false; };
    }
    listOfflineMediaByEntityId(draftScope).then((rows) => {
      if (!active) return;
      const recovered = rows.filter((row) => row.kind === 'maintenanceEvidenceDraft' && row.blob instanceof Blob)
        .map((row) => {
          const file = new File([row.blob], row.fileName || 'evidencia.jpg', {
            type: row.mimeType || row.blob.type || 'image/jpeg',
          });
          return {
            localId: row.localId,
            file,
            type: row.type || (projectMode ? 'Proyecto' : 'Antes'),
            note: row.note || '',
            capturedAt: row.capturedAt || new Date(row.createdAt || Date.now()).toISOString(),
            projectTargetType: row.projectTargetType,
            projectRelationKey: row.projectRelationKey,
            projectComponentLocalId: row.projectComponentLocalId,
            projectComponentTypeId: row.projectComponentTypeId,
            projectComponentName: row.projectComponentName,
            mimeType: row.mimeType,
            mediaType: row.mediaType,
            durationSeconds: row.durationSeconds || 0,
            size: file.size,
            previewUrl: createEvidencePreviewUrl(file),
            draftSaved: true,
          };
        });
      setEvidences((current) => {
        const present = new Set(current.map((item) => item.localId));
        return [...current, ...recovered.filter((item) => !present.has(item.localId))];
      });
    }).catch(() => {
      if (active) setDraftWarning('No fue posible recuperar las fotos pendientes de este dispositivo.');
    }).finally(() => {
      if (active) setRestoring(false);
    });
    return () => { active = false; };
  }, [draftScope, projectMode]);

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

    setPreparing(true);
    setError('');
    try {
      // La cámara de Android/iOS puede entregar archivos temporales. Estabilizar
      // antes de que el navegador suspenda o recargue la aplicación.
      const prepared = await prepareEvidenceFiles(selected, {
        allowDocuments: false, stabilizeTransientFiles: true,
      });
      const nextItems = prepared.map((item) => createPendingEvidence(item, { projectMode, target: defaultTarget }));
      for (const item of nextItems) {
        if (draftScope) {
          try {
            await queueDraftWrite(() => saveOfflineMedia({
              mediaId: `${draftScope}:${item.localId}`,
              localId: item.localId,
              entityId: draftScope,
              kind: 'maintenanceEvidenceDraft',
              blob: item.file,
              fileName: item.file.name,
              mimeType: item.mimeType,
              mediaType: item.mediaType,
              durationSeconds: item.durationSeconds,
              type: item.type,
              note: item.note,
              capturedAt: item.capturedAt,
              projectTargetType: item.projectTargetType,
              projectRelationKey: item.projectRelationKey,
              projectComponentLocalId: item.projectComponentLocalId,
              projectComponentTypeId: item.projectComponentTypeId,
              projectComponentName: item.projectComponentName,
              status: 'DRAFT',
            }));
            item.draftSaved = true;
          } catch (storageError) {
            item.draftSaved = false;
            setDraftWarning(storageError.message || 'No se pudo proteger la foto contra recargas. Guárdela antes de salir.');
          }
        } else {
          item.draftSaved = false;
          setDraftWarning('No se pudo identificar el usuario del borrador. Guarde las evidencias antes de salir.');
        }
        // Mostrar incluso cuando el navegador no admite IndexedDB; no perder la selección actual.
        setEvidences((current) => [...current, item]);
      }
    } catch (selectionError) {
      setError(selectionError.message || 'No se pudieron preparar las evidencias seleccionadas.');
    } finally {
      setPreparing(false);
    }
  }

  function updateEvidence(localId, values) {
    setEvidences((current) => current.map((item) => item.localId === localId ? { ...item, ...values } : item));
    if (draftScope) {
      queueDraftWrite(async () => {
        const mediaId = `${draftScope}:${localId}`;
        if (await getOfflineMedia(mediaId)) await updateOfflineMedia(mediaId, values);
      }).catch(() => setDraftWarning('No se pudo guardar la última edición local. Revísela antes de salir.'));
    }
  }

  function removeEvidence(localId) {
    setEvidences((current) => {
      const removed = current.find((item) => item.localId === localId);
      if (removed) releaseEvidencePreviewUrl(removed.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
    if (draftScope) {
      queueDraftWrite(() => removeOfflineMedia(`${draftScope}:${localId}`))
        .catch(() => setDraftWarning('No se pudo limpiar una evidencia descartada del almacenamiento local.'));
    }
  }

  async function upload() {
    if (!evidences.length) {
      setError('Seleccione al menos una fotografía o un video.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await draftWriteQueueRef.current;
      const pending = [...evidences];
      const result = await uploadMaintenanceImagesInBatches({
        maintenanceId,
        deviceId,
        images: pending,
        sessionToken,
      });
      const uploadedKeys = new Set((result.uploaded || []).map((row) => String(
        row.clientKey || row.FotoDispositivoID || row.id || '',
      )).filter(Boolean));

      pending.forEach((evidence) => {
        if (uploadedKeys.has(String(evidence.localId || ''))) {
          releaseEvidencePreviewUrl(evidence.previewUrl);
        }
      });
      // Solo borrar de IndexedDB las evidencias confirmadas por el backend.
      // En fallos parciales las restantes conservan el blob para recuperarse tras recarga.
      if (draftScope) {
        for (const localId of uploadedKeys) {
          await queueDraftWrite(() => removeOfflineMedia(`${draftScope}:${localId}`));
        }
      }
      setEvidences((current) => current.filter((item) => !uploadedKeys.has(String(item.localId || ''))));

      if (result.failed?.length) {
        setError(`${result.failed.length} evidencia(s) no pudieron cargarse. Las pendientes permanecen seleccionadas para reintentarlas.`);
        return;
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
      <div className="maintenance-evidence-modal__backdrop" onClick={saving || preparing ? undefined : onClose} />
      <section className="maintenance-evidence-modal__panel">
        <header>
          <div>
            <span className="eyebrow">{projectMode ? 'Evidencias del proyecto' : 'Agregar evidencias'}</span>
            <h2>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</h2>
            <p>{pick(device, ['Categoria'], 'Sin categoría')} · {pick(device, ['Zona'], 'Sin ubicación')}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving || preparing} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>

        {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}
        {draftWarning && <div className="alert alert--warning" role="alert"><Icon name="warning" /><span>{draftWarning}</span></div>}
        {restoring && <div className="info-box"><Icon name="progress_activity" /><p>Recuperando fotografías pendientes de este dispositivo...</p></div>}
        {!restoring && evidences.some((item) => item.draftSaved) && <div className="info-box" role="status"><Icon name="save" /><p>Las evidencias pendientes están guardadas en este dispositivo. Si la aplicación se recarga, vuelva a abrir este equipo para recuperarlas.</p></div>}

        <div className="maintenance-evidence-picker">
          <label className="button button--secondary">
            <Icon name="photo_camera" /> Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={addFiles} disabled={saving || preparing || restoring} />
          </label>
          <label className="button button--secondary">
            <Icon name="videocam" /> Grabar video
            <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" capture="environment" onChange={addFiles} disabled={saving || preparing || restoring} />
          </label>
          <label className="button button--secondary">
            <Icon name="perm_media" /> Seleccionar archivos
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" multiple onChange={addFiles} disabled={saving || preparing || restoring} />
          </label>
        </div>

        <div className="info-box"><Icon name="info" /><p>{projectMode
          ? 'La fecha y hora se registran automáticamente. Puede asignar cada evidencia al dispositivo principal o a uno de sus componentes relacionados. Los videos conservan el límite actual de 1 minuto y 30 segundos.'
          : 'Los videos deben durar máximo 1 minuto y 30 segundos y pesar hasta 300 MB. Los mayores de 30 MB se cargan por partes y requieren conexión a internet.'}</p></div>

        <div className="maintenance-evidence-pending-grid">
          {evidences.map((evidence) => (
            <article key={evidence.localId}>
              <EvidencePreview evidence={evidence} />
              <div className="maintenance-evidence-pending-grid__fields">
                {!projectMode && <label>
                  <span>Tipo de evidencia</span>
                  <select value={evidence.type} onChange={(event) => updateEvidence(evidence.localId, { type: event.target.value })} disabled={saving}>
                    <option value="Antes">Antes</option>
                    <option value="Despues">Después</option>
                  </select>
                </label>}
                {projectMode && <label>
                  <span>Corresponde a</span>
                  <select
                    value={`${evidence.projectTargetType === 'COMPONENTE' ? `COMPONENTE:${evidence.projectRelationKey}:${evidence.projectComponentLocalId}` : 'DISPOSITIVO'}`}
                    onChange={(event) => {
                      const target = targets.find((item) => item.value === event.target.value) || defaultTarget;
                      updateEvidence(evidence.localId, projectEvidenceTargetPatch(target || {}));
                    }}
                    disabled={saving}
                  >
                    {targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                  </select>
                </label>}
                <label>
                  <span>Nota</span>
                  <input value={evidence.note} onChange={(event) => updateEvidence(evidence.localId, { note: event.target.value })} placeholder="Descripción opcional" disabled={saving} />
                </label>
                {projectMode && <small><Icon name="schedule" /> {new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(evidence.capturedAt))}</small>}
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
              <span>{projectMode ? 'Se ordenarán automáticamente de la más nueva a la más antigua.' : 'Podrá clasificarlos como Antes o Después.'}</span>
            </div>
          )}
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={saving || preparing}>Cerrar</button>
          <button className="button button--primary" type="button" onClick={upload} disabled={saving || preparing || restoring || !evidences.length}>
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
