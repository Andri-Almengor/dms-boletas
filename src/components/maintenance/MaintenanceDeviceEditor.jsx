import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import AutosaveIndicator from '../feedback/AutosaveIndicator';
import Icon from '../common/Icon';
import TechnicianMultiSelect from '../forms/TechnicianMultiSelect';
import MaintenanceDeviceCatalogFields from './MaintenanceDeviceCatalogFields';
import MaintenanceEquipmentLocationSelect from './MaintenanceEquipmentLocationSelect';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import useMaintenanceQuestionCatalog from '../../hooks/useMaintenanceQuestionCatalog';
import { MODULE_ROUTES, normalizeItems, pick, requestAvailable } from '../../services/moduleApi';
import {
  createEvidencePreviewUrl,
  prepareEvidenceFiles,
  releaseEvidencePreviewUrl,
} from '../../utils/evidenceMedia';
import { macAddressError, normalizeMacAddress } from '../../utils/macAddress';
import {
  AUTOMATIC_PENDING_STATE,
  MANUAL_PENDING_STATE,
  effectiveMaintenanceDeviceState,
  isManualChecklistPending,
  maintenanceChecklistCompletion,
} from '../../utils/maintenanceChecklistStatus';

function Field({ label, multiline = false, ...props }) {
  return <label className="field-group"><span className="field-label">{label}</span>{multiline ? <textarea className="form-control ticket-textarea" rows="5" {...props} /> : <input className="form-control" {...props} />}</label>;
}

function Choice({ label, value, onChange, options = ['Sí', 'No'], disabled = false, note = '' }) {
  return <div className="field-group maintenance-dynamic-question"><span className="field-label">{label}</span>{note && <small className="field-hint">{note}</small>}<div className="maintenance-choice">{options.map((option) => <button type="button" key={option} className={value === option ? 'is-selected' : ''} onClick={() => onChange(option)} disabled={disabled}>{option}</button>)}</div></div>;
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

function pendingEvidence(item) {
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

function PendingEvidencePreview({ evidence }) {
  if (evidence.mediaType === 'video') {
    return <video src={evidence.previewUrl} controls preload="metadata" playsInline aria-label={evidence.file.name} />;
  }
  return <img src={evidence.previewUrl} alt={evidence.file.name} />;
}

function normalizeQuestion(item = {}, index = 0) {
  return {
    questionId: String(item.questionId || item.id || item.PreguntaDispositivoID || ''),
    typeId: String(item.typeId || item.TipoDispositivoID || ''),
    key: String(item.key || item.Clave || ''),
    label: String(item.label || item.Pregunta || item.key || ''),
    order: Number(item.order ?? item.Orden ?? (index + 1) * 10),
    responseType: String(item.responseType || item.TipoRespuesta || 'SI_NO'),
    value: String(item.value ?? ''),
    activeAtSave: item.activeAtSave !== false,
    historical: Boolean(item.historical || item.activeAtSave === false),
  };
}

export default function MaintenanceDeviceEditor({
  device,
  equipmentOptions = [],
  maintenanceLocationId = '',
  technicians = [],
  disabled,
  isAdmin,
  onChange,
  onClose,
  onCancel,
  onDelete,
  onSubmit,
  onSubmitAndContinue,
  submitLabel = 'Guardar dispositivo',
  submitting = false,
  autosaveStatus = 'idle',
}) {
  const { sessionToken, hasPermission } = useAuth();
  const category = getMaintenanceCategory(device.categoria);
  const questionCatalog = useMaintenanceQuestionCatalog(sessionToken);
  const locked = disabled || submitting;
  const cancel = onCancel || onClose;
  const canDeleteEvidence = isAdmin
    || hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('BOLETAS_EDITAR');
  const [deletingImageId, setDeletingImageId] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [loadedTechnicians, setLoadedTechnicians] = useState([]);
  const [startedAsNew] = useState(() => !device.id);

  useEffect(() => {
    document.body.classList.add('maintenance-device-editor-open');
    return () => {
      document.body.classList.remove('maintenance-device-editor-open');
      (device.newImages || []).forEach((item) => releaseEvidencePreviewUrl(item.previewUrl));
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

  const dynamicQuestions = useMemo(() => {
    const currentTypeId = String(device.tipoDispositivoId || '');
    const catalogQuestions = questionCatalog.forDevice(device).map(normalizeQuestion);
    const historical = (device.questionDetails || [])
      .map(normalizeQuestion)
      .filter((item) => item.key && (!item.typeId || !currentTypeId || item.typeId === currentTypeId));
    const historicalByKey = new Map(historical.map((item) => [item.key, item]));
    const activeKeys = new Set(catalogQuestions.map((item) => item.key));

    const active = catalogQuestions.map((question) => ({
      ...question,
      value: String(device.respuestas?.[question.key] ?? historicalByKey.get(question.key)?.value ?? ''),
      historical: false,
      activeAtSave: true,
    }));
    const inactiveHistorical = historical
      .filter((item) => !activeKeys.has(item.key) && (item.value || item.label))
      .map((item) => ({ ...item, value: String(device.respuestas?.[item.key] ?? item.value ?? ''), historical: true }));

    if (active.length || inactiveHistorical.length || (!questionCatalog.loading && !questionCatalog.error)) {
      return [...active, ...inactiveHistorical].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'es'));
    }

    return category.questions.map(([key, label], index) => ({
      questionId: `legacy:${key}`,
      typeId: currentTypeId,
      key,
      label,
      order: (index + 1) * 10,
      responseType: 'SI_NO',
      value: String(device.respuestas?.[key] || ''),
      activeAtSave: true,
      historical: false,
    }));
  }, [category.questions, device, questionCatalog]);

  const checklistCompletion = useMemo(() => maintenanceChecklistCompletion(
    { ...device, questionDetails: dynamicQuestions },
    dynamicQuestions,
  ), [device, dynamicQuestions]);
  const manualPending = isManualChecklistPending(device);
  const automaticPending = !manualPending && !checklistCompletion.complete;
  const checklistPending = manualPending || automaticPending;
  const checklistLocked = locked || manualPending;

  useEffect(() => {
    if (locked || manualPending) return;
    const desiredState = effectiveMaintenanceDeviceState(
      { ...device, questionDetails: dynamicQuestions },
      dynamicQuestions,
    );
    if (String(device.estado || '') === desiredState) return;
    onChange({ ...device, estado: desiredState });
  }, [device, dynamicQuestions, locked, manualPending, onChange]);

  function patch(values) { onChange({ ...device, ...values }); }

  function toggleChecklistPending(checked) {
    patch({
      estado: checked
        ? MANUAL_PENDING_STATE
        : (checklistCompletion.complete ? 'Correcto' : AUTOMATIC_PENDING_STATE),
    });
  }

  function updateCatalogDevice(nextDevice) {
    const previousType = String(device.tipoDispositivoId || device.categoria || '');
    const nextType = String(nextDevice.tipoDispositivoId || nextDevice.categoria || '');
    if (previousType && nextType && previousType !== nextType) {
      onChange({ ...nextDevice, respuestas: {}, questionDetails: [] });
      return;
    }
    onChange(nextDevice);
  }

  function updateQuestion(question, value) {
    const details = [...(device.questionDetails || [])];
    const index = details.findIndex((item) => String(item.key || item.Clave) === question.key);
    const nextDetail = {
      questionId: question.questionId,
      typeId: question.typeId || String(device.tipoDispositivoId || ''),
      key: question.key,
      label: question.label,
      order: question.order,
      responseType: question.responseType || 'SI_NO',
      value,
      activeAtSave: !question.historical,
      historical: question.historical,
    };
    if (index >= 0) details[index] = { ...details[index], ...nextDetail };
    else details.push(nextDetail);
    patch({
      respuestas: { ...(device.respuestas || {}), [question.key]: value },
      questionDetails: details,
    });
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setEvidenceError('');
    try {
      const prepared = await prepareEvidenceFiles(files, { allowDocuments: false });
      patch({ newImages: [...(device.newImages || []), ...prepared.map(pendingEvidence)] });
    } catch (error) {
      setEvidenceError(error.message || 'No se pudieron preparar las evidencias seleccionadas.');
    }
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
    releaseEvidencePreviewUrl(image?.previewUrl);
    patch({ newImages: (device.newImages || []).filter((item) => item.localId !== image.localId) });
  }

  function updateExistingImage(id, values) {
    patch({ images: (device.images || []).map((item) => item.id === id ? { ...item, ...values, dirty: true } : item) });
  }

  async function removeExistingImage(image) {
    const imageId = String(image.id || image.FotoDispositivoID || '');
    if (!canDeleteEvidence || !imageId || !window.confirm('¿Eliminar definitivamente esta evidencia?')) return;
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
      setEvidenceError(error.message || 'No se pudo eliminar la evidencia.');
    } finally {
      setDeletingImageId('');
    }
  }

  const totalEvidence = Number(device.images?.length || 0) + Number(device.newImages?.length || 0);
  const isNewDevice = startedAsNew;
  const missingEquipmentLocation = !String(device.ubicacionEquipoId || '').trim();
  const invalidMac = macAddressError(device.macAddress);
  const submitDisabled = locked || !onSubmit || missingEquipmentLocation || Boolean(invalidMac);

  return <div className="maintenance-device-editor" data-offline-editing-surface>
    <div className="page-header maintenance-device-editor__header">
      <button className="icon-button maintenance-device-editor__back" type="button" onClick={cancel} disabled={submitting} aria-label="Cancelar y volver a dispositivos"><Icon name="arrow_back" /></button>
      <div className="maintenance-device-editor__title"><span className="eyebrow">Dispositivo del mantenimiento</span><h2>{isNewDevice ? 'Nuevo dispositivo' : 'Editar dispositivo'}</h2></div>
      <div className="maintenance-device-editor__sync">
        <AutosaveIndicator status={autosaveStatus} />
        <button className="button button--primary button--compact maintenance-device-editor__header-save" type="button" onClick={onSubmit} disabled={submitDisabled} aria-label={submitting ? 'Guardando dispositivo' : submitLabel}>
          <Icon name={submitting ? 'progress_activity' : 'save'} />
          <span>{submitting ? 'Guardando...' : submitLabel}</span>
        </button>
      </div>
      {isAdmin && device.id ? <button className="icon-button icon-button--danger maintenance-device-editor__delete" type="button" onClick={onDelete} disabled={locked} aria-label="Eliminar dispositivo"><Icon name="delete" /></button> : <span className="maintenance-device-editor__delete-placeholder" />}
    </div>

    <div className="stack-form maintenance-device-editor__content">
      <section className="form-card maintenance-device-section-card maintenance-device-identification-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Identificación y ubicación</h3><p>La ubicación del equipo es obligatoria y define cómo se agrupará el dispositivo. Los demás campos pueden completarse según la información disponible.</p></div></div>
        <div className="maintenance-device-fields-grid">
          <div className="maintenance-device-fields-grid__full"><MaintenanceDeviceCatalogFields device={device} onChange={updateCatalogDevice} disabled={locked} /></div>
          <MaintenanceEquipmentLocationSelect locationId={maintenanceLocationId} value={device.ubicacionEquipoId} options={equipmentOptions} disabled={locked} onChange={(ubicacionEquipoId, label) => patch({ ubicacionEquipoId, ubicacionEquipoNombre: label || '', zona: label || '' })} />
          {missingEquipmentLocation && <div className="info-box maintenance-device-fields-grid__full"><Icon name="location_on" /><p>Seleccione una ubicación del equipo. Este dropdown es el que define la agrupación del dispositivo.</p></div>}
          <Field label="Nombre del dispositivo" value={device.nombre} onChange={(event) => patch({ nombre: event.target.value })} disabled={locked} autoComplete="off" />
          <Field label="Serie" value={device.serie} onChange={(event) => patch({ serie: event.target.value })} disabled={locked} autoComplete="off" />
          <Field label="Dirección MAC" value={device.macAddress || ''} onChange={(event) => patch({ macAddress: event.target.value })} onBlur={() => patch({ macAddress: normalizeMacAddress(device.macAddress) })} disabled={locked} placeholder="AA:BB:CC:DD:EE:FF" autoComplete="off" />
          {invalidMac && <div className="alert alert--error maintenance-device-fields-grid__full"><Icon name="error" /><span>{invalidMac}</span></div>}
        </div>
      </section>

      <section className="form-card maintenance-device-work-card maintenance-device-section-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Fecha y grupo de trabajo</h3><p>Los dispositivos de la misma fecha y con el mismo grupo formarán una sola boleta automática.</p></div></div>
        <div className="maintenance-device-work-grid">
          <Field label="Fecha de trabajo" type="date" value={device.fechaTrabajo || ''} onChange={(event) => patch({ fechaTrabajo: event.target.value })} disabled={locked} />
          <div className="field-group maintenance-device-technicians-field"><span className="field-label">Técnicos que realizaron este trabajo</span><TechnicianMultiSelect users={technicianOptions} selectedIds={device.tecnicoIds || []} onChange={(tecnicoIds) => patch({ tecnicoIds })} disabled={locked} /><small className="field-hint">Puede seleccionar varios técnicos o dejar el campo vacío.</small></div>
        </div>
      </section>

      <section className={`maintenance-checklist maintenance-device-section-card${checklistPending ? ' is-pending' : ''}`}>
        <div className="maintenance-checklist__heading"><h3><Icon name={category.icon} /> Checklist de {device.categoria || category.key}</h3><label className={`maintenance-checklist-pending-toggle${manualPending ? ' is-checked' : ''}`}><input type="checkbox" checked={manualPending} onChange={(event) => toggleChecklistPending(event.target.checked)} disabled={locked} /><span className="maintenance-checklist-pending-toggle__box" aria-hidden="true">{manualPending && <Icon name="check" />}</span><span className="maintenance-checklist-pending-toggle__text"><strong>Pendiente</strong><small>Bloquear pruebas por ahora</small></span></label></div>
        {manualPending && <div className="maintenance-checklist-pending-note"><Icon name="schedule" /><p>Este dispositivo fue marcado manualmente como pendiente. Quite la marca para habilitar y completar la checklist.</p></div>}
        {automaticPending && <div className="maintenance-checklist-pending-note maintenance-checklist-pending-note--automatic"><Icon name="pending_actions" /><p>Estado pendiente automático: faltan {checklistCompletion.missing.length} respuesta{checklistCompletion.missing.length === 1 ? '' : 's'} obligatoria{checklistCompletion.missing.length === 1 ? '' : 's'}.</p></div>}
        <Choice label="¿El dispositivo está funcionando correctamente?" value={device.funcionamiento} onChange={(value) => patch({ funcionamiento: value })} disabled={checklistLocked} />
        <Choice label="¿El dispositivo está en uso?" value={device.enUso} onChange={(value) => patch({ enUso: value })} options={['Sí, en uso', 'No, está guardado', 'No']} disabled={checklistLocked} />
        {questionCatalog.loading && <div className="maintenance-question-state"><Icon name="progress_activity" /><span>Cargando preguntas relacionadas con el tipo de dispositivo...</span></div>}
        {dynamicQuestions.map((question) => <Choice key={`${question.questionId || question.key}-${question.key}`} label={question.label} value={String(device.respuestas?.[question.key] ?? question.value ?? '')} onChange={(value) => updateQuestion(question, value)} disabled={checklistLocked || question.historical} note={question.historical ? 'Pregunta histórica: fue eliminada o desactivada después de este mantenimiento.' : ''} />)}
        {!questionCatalog.loading && !dynamicQuestions.length && <div className="info-box"><Icon name="info" /><p>Este tipo no tiene preguntas específicas activas. Puede agregarlas desde Administración → Preguntas de mantenimiento.</p></div>}
        {questionCatalog.error && <div className="info-box maintenance-question-warning"><Icon name="cloud_off" /><p>No se pudo actualizar el catálogo de preguntas. Se muestran las preguntas compatibles disponibles en el dispositivo.</p></div>}
        <Choice label="Estado" value={checklistPending ? '' : device.estado} onChange={(value) => patch({ estado: value })} options={['Correcto', 'Mal estado']} disabled={checklistLocked || !checklistCompletion.complete} note={!checklistCompletion.complete ? 'El estado final se habilitará cuando todas las preguntas obligatorias estén respondidas.' : ''} />
      </section>

      <section className="form-card maintenance-device-section-card"><div className="form-card__heading"><span className="section-marker" /><div><h3>Observaciones</h3><p>Registre hallazgos, fallas, trabajos realizados o recomendaciones.</p></div></div><Field label="Observación" multiline value={device.observacion} onChange={(event) => patch({ observacion: event.target.value })} disabled={locked} /></section>

      <section className="maintenance-image-section maintenance-device-section-card">
        <div className="form-card__heading"><span className="section-marker" /><div><h3>Evidencias del dispositivo</h3><p>Tome fotografías o grabe videos de hasta 20 segundos. Se subirán al guardar el dispositivo.</p></div><span className="maintenance-device-evidence-total">{totalEvidence}</span></div>
        {evidenceError && <div className="alert alert--error" role="alert"><Icon name="error" /><span>{evidenceError}</span></div>}
        {!locked && <div className="maintenance-evidence-picker maintenance-device-evidence-picker">
          <label className="button button--primary maintenance-device-camera-button"><Icon name="photo_camera" /> Tomar foto<input type="file" accept="image/*" capture="environment" onChange={addFiles} /></label>
          <label className="button button--secondary"><Icon name="videocam" /> Grabar video<input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" capture="environment" onChange={addFiles} /></label>
          <label className="button button--secondary"><Icon name="perm_media" /> Seleccionar archivos<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" multiple onChange={addFiles} /></label>
        </div>}
        <small className="maintenance-device-camera-hint"><Icon name="smartphone" /> Los videos deben durar máximo 20 segundos y pesar hasta 15 MB.</small>

        <div className="maintenance-image-grid maintenance-device-image-grid">
          {(device.images || []).map((image) => {
            const imageId = String(image.id || image.FotoDispositivoID || '');
            return <article key={imageId} className="maintenance-device-image-card">
              <MaintenanceEvidenceImage image={{ ...image, FotoDispositivoID: imageId }} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
              {canDeleteEvidence && !locked && <button type="button" className="maintenance-image-delete" onClick={() => removeExistingImage(image)} disabled={Boolean(deletingImageId)} aria-label="Eliminar evidencia"><Icon name={deletingImageId === imageId ? 'progress_activity' : 'delete'} /></button>}
              <label><span>Tipo</span><select value={pick(image, ['Tipo'], 'Antes')} onChange={(event) => updateExistingImage(image.id, { Tipo: event.target.value })} disabled={locked}><option>Antes</option><option>Despues</option></select></label>
              <label><span>Nota</span><input value={pick(image, ['Nota'])} onChange={(event) => updateExistingImage(image.id, { Nota: event.target.value })} placeholder="Descripción opcional" disabled={locked} /></label>
            </article>;
          })}
          {(device.newImages || []).map((image) => <article key={image.localId} className="maintenance-device-image-card maintenance-device-image-card--pending">
            <div className="maintenance-device-image-card__preview"><PendingEvidencePreview evidence={image} /><span><Icon name="schedule" />Pendiente</span></div>
            <button type="button" className="maintenance-image-delete" onClick={() => removeNewImage(image)} disabled={submitting} aria-label="Quitar evidencia"><Icon name="close" /></button>
            <div className="maintenance-image-type-toggle" aria-label="Tipo de evidencia">{['Antes', 'Despues'].map((type) => <button type="button" key={type} className={image.type === type ? 'is-selected' : ''} onClick={() => updateNewImage(image.localId, { type })} disabled={locked}>{type === 'Despues' ? 'Después' : type}</button>)}</div>
            <label><span>Nota</span><input value={image.note} onChange={(event) => updateNewImage(image.localId, { note: event.target.value })} placeholder="Descripción opcional" disabled={locked} /></label>
            {image.mediaType === 'video' && <small>Video · {Math.ceil(Number(image.durationSeconds || 0))} segundos</small>}
          </article>)}
          {!totalEvidence && <div className="maintenance-device-images-empty"><Icon name="perm_media" /><strong>Sin evidencias todavía</strong><span>Puede tomar fotos o grabar videos ahora o agregarlos después.</span></div>}
        </div>
      </section>

      <footer className="maintenance-device-editor__actions">
        <div className="maintenance-device-editor__actions-status"><AutosaveIndicator status={autosaveStatus} /></div>
        <button className="button button--ghost maintenance-device-cancel-button" type="button" onClick={cancel} disabled={submitting}><Icon name="close" />Cancelar</button>
        {onSubmitAndContinue && isNewDevice && !locked && <button className="button button--secondary" type="button" onClick={onSubmitAndContinue} disabled={missingEquipmentLocation || Boolean(invalidMac)}><Icon name="add_circle" />Guardar y agregar otro</button>}
        <button className="button button--primary" type="button" onClick={onSubmit} disabled={submitDisabled}><Icon name={submitting ? 'progress_activity' : 'check'} /> {submitting ? 'Guardando dispositivo...' : submitLabel}</button>
      </footer>
    </div>
  </div>;
}
