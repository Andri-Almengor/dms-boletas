import React, { useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

export default function MaintenanceEvidenceEditor({
  image,
  device,
  maintenanceId,
  sessionToken,
  isAdmin,
  onClose,
  onUpdated,
}) {
  const { hasPermission } = useAuth();
  const imageId = String(pick(image, ['FotoDispositivoID', 'id']));
  const canDeleteEvidence = isAdmin
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_EDITAR');
  const [type, setType] = useState(pick(image, ['Tipo'], 'Antes'));
  const [note, setNote] = useState(pick(image, ['Nota']));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await requestAvailable(
        MODULE_ROUTES.maintenance.imageUpdate,
        {
          maintenanceId,
          deviceId: pick(device, ['EvidenciaMantenimientoID', 'id']),
          imageId,
          FotoDispositivoID: imageId,
          Tipo: type,
          Nota: note,
        },
        sessionToken,
      );
      await onUpdated?.();
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo actualizar la evidencia.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canDeleteEvidence || !window.confirm('¿Eliminar definitivamente esta evidencia?')) return;
    setSaving(true);
    setError('');
    try {
      await requestAvailable(
        MODULE_ROUTES.maintenance.imageDelete,
        {
          maintenanceId,
          deviceId: pick(device, ['EvidenciaMantenimientoID', 'id']),
          imageId,
          FotoDispositivoID: imageId,
        },
        sessionToken,
      );
      await onUpdated?.();
      onClose();
    } catch (deleteError) {
      setError(deleteError.message || 'No se pudo eliminar la evidencia.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-evidence-modal" role="dialog" aria-modal="true" aria-label="Editar evidencia">
      <div className="maintenance-evidence-modal__backdrop" onClick={saving ? undefined : onClose} />
      <section className="maintenance-evidence-modal__panel maintenance-evidence-editor">
        <header>
          <div>
            <span className="eyebrow">Editar evidencia</span>
            <h2>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</h2>
            <p>{pick(device, ['Categoria'], 'Sin categoría')} · {pick(device, ['Zona'], 'Sin ubicación')}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>

        {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

        <div className="maintenance-evidence-editor__content">
          <div className="maintenance-evidence-editor__preview">
            <MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
          </div>
          <div className="stack-form">
            <label className="field-group">
              <span className="field-label">Tipo de evidencia</span>
              <select className="form-control" value={type} onChange={(event) => setType(event.target.value)} disabled={saving}>
                <option>Antes</option>
                <option>Despues</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Nota</span>
              <textarea className="form-control ticket-textarea" rows="5" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Descripción opcional" disabled={saving} />
            </label>
          </div>
        </div>

        <footer>
          <div>
            {canDeleteEvidence && (
              <button className="button button--danger" type="button" onClick={remove} disabled={saving}>
                <Icon name="delete" />Eliminar
              </button>
            )}
          </div>
          <div className="maintenance-evidence-editor__footer-actions">
            <button className="button button--ghost" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="button button--primary" type="button" onClick={save} disabled={saving}>
              <Icon name={saving ? 'progress_activity' : 'save'} />
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
