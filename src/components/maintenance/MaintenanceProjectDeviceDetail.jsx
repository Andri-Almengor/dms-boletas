import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import MaintenanceProjectProgressChecklist from './MaintenanceProjectProgressChecklist';
import { pick } from '../../services/moduleApi';
import {
  projectEvidenceTargets,
  projectEvidenceTargetValue,
} from '../../features/maintenance/maintenanceProjectRelations';

export function maintenanceDeviceId(device = {}) {
  return String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id'], '')).trim();
}

export function maintenanceDeviceName(device = {}) {
  return pick(device, ['NombreDispositivo', 'nombre', 'name'], 'Dispositivo');
}

export function maintenanceDeviceType(device = {}) {
  return pick(device, ['Categoria', 'TipoDispositivoNombre', 'TipoDispositivo', 'deviceTypeName'], 'Sin categoría');
}

export function maintenanceDeviceLocationName(device = {}) {
  return pick(device, [
    'UbicacionEquipoNombre',
    'UbicacionEquipo',
    'Ubicación del equipo',
    'Zona',
    'Ubicacion',
    'equipmentLocationName',
  ], 'Sin ubicación');
}

function maintenanceDeviceTechnicians(device = {}) {
  const value = pick(device, ['Tecnicos', 'TecnicoNombres', 'tecnicos'], '');
  if (Array.isArray(value)) {
    const names = value.map((item) => {
      if (typeof item === 'string') return item.trim();
      return String(pick(item, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'name'], '')).trim();
    }).filter(Boolean);
    return names.join(', ') || 'Sin dato';
  }
  if (value && typeof value === 'object') {
    return String(pick(value, ['NombreCompleto', 'Nombre', 'NombreUsuario', 'name'], 'Sin dato'));
  }
  return String(value || 'Sin dato');
}

function parseAnswers(device = {}) {
  try {
    return typeof device.RespuestasJSON === 'string'
      ? JSON.parse(device.RespuestasJSON || '{}')
      : device.RespuestasJSON || {};
  } catch {
    return {};
  }
}

function projectQuestionDetails(answers = {}) {
  return Array.isArray(answers.__preguntas) ? answers.__preguntas : [];
}

function projectAnswerLabel(question = {}) {
  return String(question.label || question.Pregunta || question.key || question.Clave || 'Campo').trim();
}

function projectRelationValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ProjectDeviceAnswers({ device }) {
  const answers = parseAnswers(device);
  const details = projectQuestionDetails(answers)
    .filter((question) => question.activeAtSave !== false)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));

  if (!details.length) {
    return <div className="info-box"><Icon name="info" /><p>Este dispositivo no tiene campos adicionales configurados.</p></div>;
  }

  return <div className="maintenance-project-detail-fields">
    {details.map((question) => {
      const key = String(question.key || question.Clave || '');
      const responseType = String(question.responseType || question.TipoRespuesta || 'SI_NO').toUpperCase();
      const value = answers[key] ?? question.value ?? '';

      if (responseType !== 'RELACION_DISPOSITIVO') {
        return <div className="maintenance-project-detail-value" key={key || projectAnswerLabel(question)}>
          <span>{projectAnswerLabel(question)}</span>
          <strong>{String(value || 'Sin dato')}</strong>
        </div>;
      }

      const relation = projectRelationValue(value);
      const items = relation.enabled && Array.isArray(relation.items) ? relation.items : [];
      return <section className="maintenance-project-detail-relation" key={key || projectAnswerLabel(question)}>
        <header><div><span>{projectAnswerLabel(question)}</span><strong>{items.length ? `${items.length} relacionado${items.length === 1 ? '' : 's'}` : 'No aplica'}</strong></div></header>
        {items.length > 0 && <div className="maintenance-project-detail-components">
          {items.map((item, index) => {
            const nestedAnswers = item.respuestas && typeof item.respuestas === 'object' ? item.respuestas : {};
            const nestedDetails = Array.isArray(item.questionDetails) ? item.questionDetails : [];
            return <article key={item.localId || `${key}-${index}`}>
              <div className="maintenance-project-detail-component__heading"><Icon name="extension" /><div><strong>{item.nombre || `${item.categoria || relation.relatedTypeName || 'Componente'} ${index + 1}`}</strong><small>{item.categoria || relation.relatedTypeName || 'Dispositivo relacionado'}</small></div></div>
              <dl>
                {item.fabricante && <><dt>Marca</dt><dd>{item.fabricante}</dd></>}
                {item.modelo && <><dt>Modelo</dt><dd>{item.modelo}</dd></>}
                {item.serie && <><dt>Serie</dt><dd>{item.serie}</dd></>}
                {item.macAddress && <><dt>MAC</dt><dd>{item.macAddress}</dd></>}
              </dl>
              {nestedDetails.length > 0 && <div className="maintenance-project-detail-component__answers">
                {nestedDetails.filter((entry) => entry.activeAtSave !== false).map((entry) => {
                  const nestedKey = String(entry.key || entry.Clave || '');
                  return <div key={nestedKey}><span>{projectAnswerLabel(entry)}</span><strong>{String(nestedAnswers[nestedKey] ?? entry.value ?? 'Sin dato')}</strong></div>;
                })}
              </div>}
            </article>;
          })}
        </div>}
      </section>;
    })}
  </div>;
}

function evidenceTimestamp(image = {}) {
  const value = pick(image, ['FechaCaptura', 'FechaCreacion', 'FechaActualizacion'], '');
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function sortedEvidence(images = []) {
  return [...images].sort((left, right) => evidenceTimestamp(right) - evidenceTimestamp(left));
}

function projectEvidenceLabel(device, image) {
  const value = projectEvidenceTargetValue(image);
  const target = projectEvidenceTargets(device).find((item) => item.value === value);
  return target?.label || pick(image, ['ProyectoComponenteNombre'], 'Dispositivo principal');
}

function evidenceDateLabel(image = {}) {
  const value = pick(image, ['FechaCaptura', 'FechaCreacion'], '');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function isOffline(device = {}) {
  return Boolean(device.OfflinePendiente)
    || (device.Imagenes || []).some((image) => Boolean(image.OfflinePendiente));
}

function stateText(value) {
  return String(value || 'Sin estado').toUpperCase();
}

export default function MaintenanceProjectDeviceDetail({
  device,
  projectChecklist,
  sessionToken,
  pending = false,
  canEdit = false,
  evidenceEnabled = true,
  onEditDevice,
  onAddEvidence,
  onEditEvidence,
}) {
  const [evidenceTargetFilter, setEvidenceTargetFilter] = useState('TODAS');
  const allImages = useMemo(() => sortedEvidence(device?.Imagenes || []), [device]);
  const targetOptions = useMemo(() => projectEvidenceTargets(device || {}), [device]);
  const images = evidenceTargetFilter === 'TODAS'
    ? allImages
    : allImages.filter((image) => projectEvidenceTargetValue(image) === evidenceTargetFilter);

  useEffect(() => {
    setEvidenceTargetFilter('TODAS');
  }, [device && maintenanceDeviceId(device)]);

  if (!device) return null;

  return <section className="maintenance-project-device-detail-card">
    <div className="maintenance-project-device-detail-card__heading">
      <div>
        <span className="eyebrow">Detalle del dispositivo</span>
        <h2>{maintenanceDeviceName(device)}</h2>
        <p>{maintenanceDeviceType(device)} · {maintenanceDeviceLocationName(device)}</p>
      </div>
      {pending && canEdit && onEditDevice && <button className="button button--secondary button--compact" type="button" onClick={() => onEditDevice(device)}><Icon name="edit" />Editar dispositivo</button>}
    </div>

    <div className="maintenance-project-device-summary-grid">
      <div><span>Tipo</span><strong>{maintenanceDeviceType(device)}</strong></div>
      <div><span>Ubicación</span><strong>{maintenanceDeviceLocationName(device)}</strong></div>
      <div><span>Marca</span><strong>{pick(device, ['Fabricante'], 'Sin dato')}</strong></div>
      <div><span>Modelo</span><strong>{pick(device, ['Modelo'], 'Sin dato')}</strong></div>
      <div><span>Serie</span><strong>{pick(device, ['Serie'], 'Sin dato')}</strong></div>
      <div><span>Dirección MAC</span><strong>{pick(device, ['DireccionMAC', 'macAddress'], 'Sin dato')}</strong></div>
      <div><span>Fecha de trabajo</span><strong>{pick(device, ['FechaTrabajo'], 'Sin dato')}</strong></div>
      <div><span>Técnicos</span><strong>{maintenanceDeviceTechnicians(device)}</strong></div>
      <div><span>Estado</span><strong>{stateText(pick(device, ['Estado']))}</strong></div>
      <div><span>Evidencias</span><strong>{allImages.length}</strong></div>
    </div>

    <ProjectDeviceAnswers device={device} />
    <MaintenanceProjectProgressChecklist checklist={projectChecklist} device={device} disabled />

    {pick(device, ['Observacion']) && <div className="maintenance-inventory-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}

    <section className="maintenance-project-device-evidence-section">
      <div className="maintenance-inventory-evidence-heading">
        <div><strong>Evidencias</strong><span>{images.length} de {allImages.length} archivo{allImages.length === 1 ? '' : 's'} · más reciente primero</span></div>
        <div className="maintenance-project-evidence-heading-actions">
          {targetOptions.length > 1 && <label className="maintenance-project-evidence-filter"><span>Mostrar</span><select value={evidenceTargetFilter} onChange={(event) => setEvidenceTargetFilter(event.target.value)}><option value="TODAS">Todas las evidencias</option>{targetOptions.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>}
          {evidenceEnabled && pending && canEdit && onAddEvidence && <button className="button button--secondary button--compact" type="button" onClick={() => onAddEvidence(device)}><Icon name="add_a_photo" />Agregar evidencia</button>}
        </div>
      </div>

      {evidenceEnabled && <div className="maintenance-inventory-images maintenance-project-device-gallery">
        {images.map((image) => <figure key={pick(image, ['FotoDispositivoID', 'id'])}>
          <MaintenanceEvidenceImage image={image} galleryImages={images} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
          <figcaption><strong>{projectEvidenceLabel(device, image)}</strong><span>{evidenceDateLabel(image)}</span><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>
          {pending && canEdit && onEditEvidence && <button type="button" onClick={() => onEditEvidence(image, device)}><Icon name="edit" />Editar evidencia</button>}
        </figure>)}
        {!images.length && <div className="maintenance-inventory-no-images"><Icon name="photo_library" /><span>Sin fotografías registradas.</span></div>}
      </div>}

      {!evidenceEnabled && <div className="info-box"><Icon name="photo_library" /><p>La carga de evidencias no está disponible en esta vista.</p></div>}
    </section>

    {isOffline(device) && <div className="maintenance-inventory-offline-note"><Icon name="cloud_off" />Este dispositivo y sus evidencias están guardados en este equipo y se enviarán al recuperar conexión.</div>}
    <span className="maintenance-inventory-device-id">ID: {maintenanceDeviceId(device)}</span>
  </section>;
}
