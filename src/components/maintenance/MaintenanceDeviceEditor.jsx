import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import AutosaveIndicator from '../feedback/AutosaveIndicator';
import Icon from '../common/Icon';
import TechnicianMultiSelect from '../forms/TechnicianMultiSelect';
import MaintenanceDeviceCatalogFields from './MaintenanceDeviceCatalogFields';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="5" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function Choice({ label, value, onChange, options = ['Sí', 'No'], disabled = false }) {
  return <div className="field-group"><span className="field-label">{label}</span><div className="maintenance-choice">{options.map((option) => <button type="button" key={option} className={value === option ? 'is-selected' : ''} onClick={() => onChange(option)} disabled={disabled}>{option}</button>)}</div></div>;
}

function currentRoute() {
  return `${window.location.pathname}${window.location.search || ''}`;
}

function technicianOption(row) {
  const label = String(pick(row, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'Correo'], '')).trim();
  const parts = label.split(/\s+/);
  return {
    value: String(pick(row, ['UsuarioID', 'id'], '')),
    label,
    note: pick(row, ['Correo', 'NombreUsuario']),
    initials: `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase(),
  };
}

function pendingImage(file) {
  return {
    localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    file,
    type: 'Antes',
    note: '',
    previewUrl: URL.createObjectURL(file),
  };
}

export default function MaintenanceDeviceEditor({
  device,
  equipmentOptions = [],
  technicians = [],
  disabled,
  isAdmin,
  onChange,
  onClose,
  onDelete,
  onSubmit,
  onSubmitAndContinue,
  submitLabel = 'Guardar dispositivo',
  submitting = false,
  autosaveStatus = 'idle',
}) {
  const { sessionToken, hasPermission } = useAuth();
  const category = getMaintenanceCategory(device.categoria);
  const locked = disabled || submitting;
  const canDeleteEvidence = isAdmin
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_EDITAR');
  const [deletingImageId, setDeletingImageId] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [loadedTechnicians, setLoadedTechnicians] = useState([]);

  useEffect(() => {
    document.body.classList.add('maintenance-device-editor-open');
    return () => {
      document.body.classList.remove('maintenance-device-editor-open');
      window.dispatchEvent(new CustomEvent('dms-offline-editing-complete'));
    };
  }, []);

  useEffect(() => {
    if (technicians.length || !sessionToken) return undefined;
    let active = true;
    requestAvailable(MODULE_ROUTES.users.list, { page: 1, pageSize: 1000, activo: true }, sessionToken)
      .then((data) => {
        if (!active) return;
        setLoadedTechnicians(normalizeItems(data)
          .filter((item) => String(pick(item, ['Estado'], 'ACTIVO')).toUpperCase() === 'ACTIVO')
          .map(technicianOption)
          .filter((item) => item.value && item.label));
      })
      .catch((error) => active && setEvidenceError(error.message || 'No se pudieron cargar los técnicos.'));
    return () => { active = false; };
  }, [technicians.length, sessionToken]);

  const technicianOptions = useMemo(
    () => (technicians.length ? technicians : loadedTechnicians),
    [technicians, loadedTechnicians],
  );

  function patch(values) { onChange({ ...device, ...values }); }

  function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const invalid = files.find((file) => !String(file.type || '').startsWith('image/') || file.size > MAX_IMAGE_BYTES);
    if (invalid) {
      setEvidenceError(invalid.size > MAX_IMAGE_BYTES
        ? `La imagen ${invalid.name} supera el límite de 15 MB.`
        : `El archivo ${invalid.name} no es una imagen válida.`);
      return;
    }

    setEvidenceError('');
    patch({ newImages: [...(device.newImages || []), ...files.map(pendingImage)] });
  }

  function updateNewImage(localId, values) {
    patch({ newImages: (device.newImages || []).map((item) => item.localId === localId ? { ...item, ...values } : item) });
  }

  function removeNewImage(image) {
    if (image?.file) {
      window.dispatchEvent(new CustomEvent('dms-draft-file-removed', {
        detail: { route: currentRoute(), file: image.file },
      }));
    }
    if (image?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
    patch({ newImages: (device.newImages || []).filter((item) => item.localId !== image.localId) });
  }

  function updateExistingImage(id, values) {
    patch({ images: (device.images || []).map((item) => item.id === id ? { ...item, ...values, dirty: true } : item) });
  }

  async function removeExistingImage(image) {
    const imageId = String(image.id || image.FotoDispositivoID || '');
    if (!canDeleteEvidence || !imageId || !window.confirm('¿Eliminar definitivamente esta fotografía?')) return;
    setDeletingImageId(imageId);
    setEvidenceError('');
    try {
      await requestAvailable(MODULE_ROUTES.maintenance.imageDelete, {
        imageId,
        FotoDispositivoID: imageId,
        deviceId: device.id,
      }, sessionToken);
      patch({ images: (device.images || []).filter((item) => String(item.id || item.FotoDispositivoID) !== imageId) });
    } catch (error) {
      setEvidenceError(error.message || 'No se pudo eliminar la fotografía.');
    } finally {
      setDeletingImageId('');
    }
  }

  const totalEvidence = Number(device.images?.length || 0) + Number(device.newImages?.length || 0);
  const isNewDevice = !device.id;

  return <div className="maintenance-device-editor" data-offline-editing-surface>
    <div className="page-header maintenance-device-editor__header">
      <button className="icon-button maintenance-device-editor__back" type="button" onClick={onClose} disabled={submitting} aria-label="Volver a dispositivos"><Icon name="arrow_back" /></button>
      <div className="maintenance-device-editor__title"><span className="eyebrow">Dispositivo del mantenimiento</span><h2>{isNewDevice ? 'Nuevo dispositivo' : 'Editar dispositivo'}</h2></div>
      <div className="maintenance-device-editor__sync"><AutosaveIndicator status={autosaveStatus} /></div>
      {isAdmin && device.id ? <button className="icon-button icon-button--danger maintenance-device-editor__delete" type="button" onClick={onDelete} disabled={locked} aria-label="Eliminar dispositivo"><Icon name="delete" /></button> : <span className="maintenance-device-editor__delete-placeholder" />}
    </div>

    <div className="stack-form maintenance-device-editor__content">
      <section className="form-card maintenance-device-section-card maintenance-device-identification-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Identificación y ubicación</h3><p>Complete primero los campos obligatorios para que el dispositivo pueda guardarse y sincronizarse.</p></div></div>
        <div className="maintenance-device-fields-grid">
          <div className="maintenance-device-fields-grid__full"><MaintenanceDeviceCatalogFields device={device} onChange={onChange} disabled={locked} /></div>
          <label className="field-group"><span className="field-label">Ubicación del equipo</span><select className="form-control" value={device.ubicacionEquipoId} onChange={(event) => patch({ ubicacionEquipoId: event.target.value, zona: equipmentOptions.find((item) => item.value === event.target.value)?.label || device.zona })} disabled={locked}><option value="">Seleccione una opción</option>{equipmentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <Field label="Ubicación específica del dispositivo *" value={device.zona} onChange={(event) => patch({ zona: event.target.value })} disabled={locked} autoComplete="off" />
          <Field label="Nombre del dispositivo *" value={device.nombre} onChange={(event) => patch({ nombre: event.target.value })} disabled={locked} autoComplete="off" />
          <Field label="Serie" value={device.serie} onChange={(event) => patch({ serie: event.target.value })} disabled={locked} autoComplete="off" />
        </div>
      </section>

      <section className="form-card maintenance-device-work-card maintenance-device-section-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Fecha y grupo de trabajo</h3><p>Los dispositivos de la misma fecha y con el mismo grupo formarán una sola boleta automática.</p></div></div>
        <div className="maintenance-device-work-grid">
          <Field label="Fecha de trabajo *" type="date" value={device.fechaTrabajo || ''} onChange={(event) => patch({ fechaTrabajo: event.target.value })} disabled={locked} />
          <div className="field-group maintenance-device-technicians-field">
            <span className="field-label">Técnicos que realizaron este trabajo *</span>
            <TechnicianMultiSelect users={technicianOptions} selectedIds={device.tecnicoIds || []} onChange={(tecnicoIds) => patch({ tecnicoIds })} disabled={locked} />
            <small className="field-hint">Puede seleccionar varios técnicos.</small>
          </div>
        </div>
      </section>

      <section className="maintenance-checklist maintenance-device-section-card">
        <h3><Icon name={category.icon} /> Checklist de {category.key}</h3>
        <Choice label="¿El dispositivo está funcionando correctamente?" value={device.funcionamiento} onChange={(value) => patch({ funcionamiento: value })} disabled={locked} />
        <Choice label="¿El dispositivo está en uso?" value={device.enUso} onChange={(value) => patch({ enUso: value })} options={['Sí, en uso', 'No, está guardado', 'No']} disabled={locked} />
        {category.questions.map(([key, label]) => <Choice key={key} label={label} value={device.respuestas[key] || ''} onChange={(value) => patch({ respuestas: { ...device.respuestas, [key]: value } })} disabled={locked} />)}
        {!category.questions.length && <div className="info-box"><Icon name="info" /><p>Este tipo no tiene preguntas específicas. Registre funcionamiento, uso, estado y observaciones.</p></div>}
        <Choice label="Estado" value={device.estado} onChange={(value) => patch({ estado: value })} options={['Correcto', 'Mal estado']} disabled={locked} />
      </section>

      <section className="form-card maintenance-device-section-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Observaciones</h3><p>Registre hallazgos, fallas, trabajos realizados o recomendaciones.</p></div></div>
        <Field label="Observación" multiline value={device.observacion} onChange={(event) => patch({ observacion: event.target.value })} disabled={locked} />
      </section>

      <section className="maintenance-image-section maintenance-device-section-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Evidencias del dispositivo</h3><p>Tome una fotografía con la cámara o seleccione varias imágenes. Permanecen guardadas mientras termina de editar.</p></div><span className="maintenance-device-evidence-total">{totalEvidence}</span></div>
        {evidenceError && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{evidenceError}</span></div>}
        {!locked && <div className="maintenance-evidence-picker maintenance-device-evidence-picker">
          <label className="button button--primary maintenance-device-camera-button">
            <Icon name="photo_camera" /> Tomar foto
            <input type="file" accept="image/*" capture="environment" onChange={addFiles} />
          </label>
          <label className="button button--secondary">
            <Icon name="photo_library" /> Seleccionar imágenes
            <input type="file" accept="image/*" multiple onChange={addFiles} />
          </label>
        </div>}
        <small className="maintenance-device-camera-hint"><Icon name="smartphone" /> En el móvil, “Tomar foto” abre la cámara trasera.</small>

        <div className="maintenance-image-grid maintenance-device-image-grid">
          {(device.images || []).map((image) => {
            const imageId = String(image.id || image.FotoDispositivoID || '');
            return <article key={imageId} className="maintenance-device-image-card">
              <MaintenanceEvidenceImage image={{ ...image, FotoDispositivoID: imageId }} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
              {canDeleteEvidence && !locked && <button type="button" className="maintenance-image-delete" onClick={() => removeExistingImage(image)} disabled={Boolean(deletingImageId)} aria-label="Eliminar fotografía"><Icon name={deletingImageId === imageId ? 'progress_activity' : 'delete'} /></button>}
              <label><span>Tipo</span><select value={pick(image, ['Tipo'], 'Antes')} onChange={(event) => updateExistingImage(image.id, { Tipo: event.target.value })} disabled={locked}><option>Antes</option><option>Despues</option></select></label>
              <label><span>Nota</span><input value={pick(image, ['Nota'])} onChange={(event) => updateExistingImage(image.id, { Nota: event.target.value })} placeholder="Descripción opcional" disabled={locked} /></label>
            </article>;
          })}
          {(device.newImages || []).map((image) => <article key={image.localId} className="maintenance-device-image-card maintenance-device-image-card--pending">
            <div className="maintenance-device-image-card__preview"><img src={image.previewUrl} alt={image.file.name} /><span><Icon name="schedule" />Pendiente</span></div>
            <button type="button" className="maintenance-image-delete" onClick={() => removeNewImage(image)} disabled={submitting} aria-label="Quitar imagen"><Icon name="close" /></button>
            <div className="maintenance-image-type-toggle" aria-label="Tipo de evidencia">
              {['Antes', 'Despues'].map((type) => <button type="button" key={type} className={image.type === type ? 'is-selected' : ''} onClick={() => updateNewImage(image.localId, { type })} disabled={locked}>{type === 'Despues' ? 'Después' : type}</button>)}
            </div>
            <label><span>Nota</span><input value={image.note} onChange={(event) => updateNewImage(image.localId, { note: event.target.value })} placeholder="Descripción opcional" disabled={locked} /></label>
          </article>)}
          {!totalEvidence && <div className="maintenance-device-images-empty"><Icon name="add_a_photo" /><strong>Sin evidencias todavía</strong><span>Puede tomar fotos ahora o agregarlas después.</span></div>}
        </div>
      </section>

      <footer className="maintenance-device-editor__actions">
        <div className="maintenance-device-editor__actions-status"><AutosaveIndicator status={autosaveStatus} /></div>
        {onSubmitAndContinue && isNewDevice && !locked && <button className="button button--secondary" type="button" onClick={onSubmitAndContinue}><Icon name="add_circle" />Guardar y agregar otro</button>}
        <button className="button button--primary" type="button" onClick={onSubmit || onClose} disabled={locked}><Icon name={submitting ? 'progress_activity' : 'check'} /> {submitting ? 'Guardando dispositivo...' : submitLabel}</button>
      </footer>
    </div>
  </div>;
}
