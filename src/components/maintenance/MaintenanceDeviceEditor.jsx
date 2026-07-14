import React from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import MaintenanceDeviceCatalogFields from './MaintenanceDeviceCatalogFields';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="5" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function Choice({ label, value, onChange, options = ['Sí', 'No'], disabled = false }) {
  return <div className="field-group"><span className="field-label">{label}</span><div className="maintenance-choice">{options.map((option) => <button type="button" key={option} className={value === option ? 'is-selected' : ''} onClick={() => onChange(option)} disabled={disabled}>{option}</button>)}</div></div>;
}

export default function MaintenanceDeviceEditor({ device, equipmentOptions = [], disabled, isAdmin, onChange, onClose, onDelete, onSubmit, submitLabel = 'Listo', submitting = false }) {
  const { sessionToken } = useAuth();
  const category = getMaintenanceCategory(device.categoria);
  const locked = disabled || submitting;
  function patch(values) { onChange({ ...device, ...values }); }
  function addFiles(event) {
    const files = Array.from(event.target.files || []);
    patch({ newImages: [...device.newImages, ...files.map((file) => ({ localId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, file, type: 'Antes', note: '', previewUrl: URL.createObjectURL(file) }))] });
    event.target.value = '';
  }
  function updateNewImage(localId, values) { patch({ newImages: device.newImages.map((item) => item.localId === localId ? { ...item, ...values } : item) }); }
  function updateExistingImage(id, values) { patch({ images: device.images.map((item) => item.id === id ? { ...item, ...values, dirty: true } : item) }); }

  return <div className="maintenance-device-editor">
    <div className="page-header maintenance-device-editor__header"><button className="icon-button" type="button" onClick={onClose} disabled={submitting}><Icon name="arrow_back" /></button><div><span className="eyebrow">Dispositivo del mantenimiento</span><h2>{device.id ? 'Editar dispositivo' : 'Nuevo dispositivo'}</h2></div>{isAdmin && device.id ? <button className="icon-button icon-button--danger" type="button" onClick={onDelete} disabled={locked}><Icon name="delete" /></button> : <span />}</div>
    <div className="stack-form">
      <MaintenanceDeviceCatalogFields device={device} onChange={onChange} disabled={locked} />
      <label className="field-group"><span className="field-label">Ubicación del equipo</span><select className="form-control" value={device.ubicacionEquipoId} onChange={(event) => patch({ ubicacionEquipoId: event.target.value, zona: equipmentOptions.find((item) => item.value === event.target.value)?.label || device.zona })} disabled={locked}><option value="">Seleccione una opción</option>{equipmentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <Field label="Ubicación específica del dispositivo *" value={device.zona} onChange={(event) => patch({ zona: event.target.value })} disabled={locked} />
      <Field label="Nombre del dispositivo *" value={device.nombre} onChange={(event) => patch({ nombre: event.target.value })} disabled={locked} />
      <Field label="Serie" value={device.serie} onChange={(event) => patch({ serie: event.target.value })} disabled={locked} />
      <div className="maintenance-checklist"><h3><Icon name={category.icon} /> Checklist de {category.key}</h3><Choice label="¿El dispositivo está funcionando correctamente?" value={device.funcionamiento} onChange={(value) => patch({ funcionamiento: value })} disabled={locked} /><Choice label="¿El dispositivo está en uso?" value={device.enUso} onChange={(value) => patch({ enUso: value })} options={['Sí, en uso', 'No, está guardado', 'No']} disabled={locked} />{category.questions.map(([key, label]) => <Choice key={key} label={label} value={device.respuestas[key] || ''} onChange={(value) => patch({ respuestas: { ...device.respuestas, [key]: value } })} disabled={locked} />)}{!category.questions.length && <div className="info-box"><Icon name="info" /><p>Este tipo no tiene preguntas específicas. Registre funcionamiento, uso, estado y observaciones.</p></div>}<Choice label="Estado" value={device.estado} onChange={(value) => patch({ estado: value })} options={['Correcto', 'Mal estado']} disabled={locked} /></div>
      <Field label="Observación" multiline value={device.observacion} onChange={(event) => patch({ observacion: event.target.value })} disabled={locked} />
      <section className="maintenance-image-section"><div className="form-card__heading"><span className="section-marker" /><div><h3>Evidencias del dispositivo</h3><p>Cada fotografía pertenece únicamente a este equipo.</p></div></div>{!locked && <label className="knowledge-file-drop"><input type="file" accept="image/*" multiple onChange={addFiles} /><Icon name="add_a_photo" /><strong>Agregar fotografías</strong><span>Selecciona Antes o Después y agrega una nota.</span></label>}<div className="maintenance-image-grid">{device.images.map((image) => <article key={image.id}><MaintenanceEvidenceImage image={{ ...image, FotoDispositivoID: image.id || image.FotoDispositivoID }} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} /><select value={pick(image, ['Tipo'], 'Antes')} onChange={(event) => updateExistingImage(image.id, { Tipo: event.target.value })} disabled={locked}><option>Antes</option><option>Despues</option></select><input value={pick(image, ['Nota'])} onChange={(event) => updateExistingImage(image.id, { Nota: event.target.value })} placeholder="Nota" disabled={locked} /></article>)}{device.newImages.map((image) => <article key={image.localId}><img src={image.previewUrl} alt={image.file.name} /><select value={image.type} onChange={(event) => updateNewImage(image.localId, { type: event.target.value })} disabled={locked}><option>Antes</option><option>Despues</option></select><input value={image.note} onChange={(event) => updateNewImage(image.localId, { note: event.target.value })} placeholder="Nota" disabled={locked} /><button type="button" className="icon-button icon-button--danger" onClick={() => patch({ newImages: device.newImages.filter((item) => item.localId !== image.localId) })} disabled={submitting}><Icon name="close" /></button></article>)}</div></section>
      <button className="button button--primary" type="button" onClick={onSubmit || onClose} disabled={locked}><Icon name={submitting ? 'progress_activity' : 'check'} /> {submitting ? 'Guardando dispositivo...' : submitLabel}</button>
    </div>
  </div>;
}
