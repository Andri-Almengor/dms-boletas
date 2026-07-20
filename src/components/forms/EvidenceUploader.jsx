import React from 'react';
import Icon from '../common/Icon';

function currentRoute() {
  return `${window.location.pathname}${window.location.search || ''}`;
}

export default function EvidenceUploader({ items, onAdd, onUpdate, onRemove, disabled }) {
  function remove(index) {
    const item = items[index];
    if (item?.file) {
      window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
        detail: { route: currentRoute(), file: item.file },
      }));
    }
    onRemove(index);
  }

  return (
    <div className="evidence-uploader" data-offline-editing-surface>
      <div className="evidence-upload-actions">
        <label className="ticket-camera-button">
          <input type="file" accept="image/*" capture="environment" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="photo_camera" /><strong>Tomar foto</strong><span>Usar cámara del dispositivo</span>
        </label>
        <label className="ticket-file-button">
          <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="photo_library" /><strong>Elegir varios archivos</strong><span>Seleccione una o más imágenes</span>
        </label>
      </div>
      <div className="info-box"><Icon name="info" /><p>Puede seleccionar varias imágenes de la galería en una sola acción. Sin internet, las evidencias quedan protegidas en este dispositivo y se enviarán al guardar y sincronizar la boleta.</p></div>
      <div className="ticket-evidence-grid">
        {items.map((item, index) => (
          <article className="evidence-edit-card" key={item.localId || `${item.name}-${index}`}>
            {item.previewUrl
              ? <img src={item.previewUrl} alt={item.name || `Evidencia ${index + 1}`} />
              : <div className="evidence-file-icon"><Icon name="description" /></div>}
            <div className="evidence-edit-card__fields">
              <input className="form-control" value={item.name} onChange={(event) => onUpdate(index, { name: event.target.value })} placeholder="Nombre de la evidencia" disabled={disabled} />
              <textarea className="form-control ticket-textarea" rows="2" value={item.note} onChange={(event) => onUpdate(index, { note: event.target.value })} placeholder="Nota opcional" disabled={disabled} />
            </div>
            <button className="evidence-remove" type="button" onClick={() => remove(index)} disabled={disabled} aria-label="Eliminar evidencia"><Icon name="delete" /></button>
          </article>
        ))}
        <label className="ticket-evidence-add">
          <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={onAdd} disabled={disabled} />
          <Icon name="add_a_photo" /><span>Añadir varias</span>
        </label>
      </div>
    </div>
  );
}
