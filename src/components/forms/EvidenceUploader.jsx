import React, { memo } from 'react';
import { releaseLocalFile } from '../../utils/localFileLifecycle';
import { evidenceMediaKind } from '../../utils/evidenceMedia';
import Icon from '../common/Icon';

function EvidencePreview({ item, index }) {
  const kind = item.mediaType || evidenceMediaKind(item.file || item);
  if (kind === 'video' && item.previewUrl) {
    return <video src={item.previewUrl} controls preload="metadata" playsInline aria-label={item.name || `Video ${index + 1}`} />;
  }
  if (kind === 'image' && item.previewUrl) {
    return <img src={item.previewUrl} alt={item.name || `Evidencia ${index + 1}`} loading="lazy" decoding="async" />;
  }
  return <div className="evidence-file-icon"><Icon name={kind === 'video' ? 'videocam' : 'description'} /></div>;
}

function EvidenceUploader({ items, onAdd, onUpdate, onRemove, disabled }) {
  function remove(index) {
    releaseLocalFile(items[index]);
    onRemove(index);
  }

  return (
    <div className="evidence-uploader" data-offline-editing-surface>
      <div className="evidence-upload-actions">
        <label className="ticket-camera-button">
          <input type="file" accept="image/*" capture="environment" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="photo_camera" /><strong>Tomar foto</strong><span>Usar cámara del dispositivo</span>
        </label>
        <label className="ticket-camera-button ticket-video-button">
          <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" capture="environment" onChange={onAdd} disabled={disabled} />
          <Icon name="videocam" /><strong>Grabar video</strong><span>Máximo 20 segundos</span>
        </label>
        <label className="ticket-file-button">
          <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm,.pdf,.doc,.docx" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="perm_media" /><strong>Elegir varios archivos</strong><span>Fotos, videos, PDF o Word</span>
        </label>
      </div>
      <div className="info-box"><Icon name="info" /><p>Los videos deben durar máximo 20 segundos y pesar hasta 15 MB. Sin internet, las evidencias quedan protegidas en este dispositivo y se enviarán al guardar y sincronizar la boleta.</p></div>
      <div className="ticket-evidence-grid">
        {items.map((item, index) => (
          <article className="evidence-edit-card" key={item.localId || `${item.name}-${index}`}>
            <EvidencePreview item={item} index={index} />
            <div className="evidence-edit-card__fields">
              <input className="form-control" value={item.name} onChange={(event) => onUpdate(index, { name: event.target.value })} placeholder="Nombre de la evidencia" disabled={disabled} />
              <textarea className="form-control ticket-textarea" rows="2" value={item.note} onChange={(event) => onUpdate(index, { note: event.target.value })} placeholder="Nota opcional" disabled={disabled} />
              {item.mediaType === 'video' && <small className="field-hint">Video · {Math.ceil(Number(item.durationSeconds || 0))} s</small>}
            </div>
            <button className="evidence-remove" type="button" onClick={() => remove(index)} disabled={disabled} aria-label="Eliminar evidencia"><Icon name="delete" /></button>
          </article>
        ))}
        <label className="ticket-evidence-add">
          <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm,.pdf,.doc,.docx" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="add_to_photos" /><span>Añadir varias</span>
        </label>
      </div>
    </div>
  );
}

export default memo(EvidenceUploader);
