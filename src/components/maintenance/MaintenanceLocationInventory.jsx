import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import FilterDrawer from '../forms/FilterDrawer';
import AdminEntityModal from '../forms/AdminEntityModal';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  projectEvidenceTargets,
  projectEvidenceTargetValue,
} from '../../features/maintenance/maintenanceProjectRelations';

const NATURAL_COLLATOR = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
  ignorePunctuation: true,
});

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function naturalCompare(left, right) {
  return NATURAL_COLLATOR.compare(String(left || ''), String(right || ''));
}

function deviceType(device) {
  return pick(device, ['Categoria', 'TipoDispositivoNombre', 'TipoDispositivo', 'deviceTypeName'], 'Sin categoría');
}

function deviceLocationId(device) {
  return String(pick(device, ['UbicacionEquipoID', 'ubicacionEquipoId'], '')).trim();
}

function deviceLocationName(device) {
  return pick(device, [
    'UbicacionEquipoNombre',
    'UbicacionEquipo',
    'Ubicación del equipo',
    'Zona',
    'Ubicacion',
    'equipmentLocationName',
  ], 'Sin ubicación');
}

function deviceName(device) {
  return pick(device, ['NombreDispositivo', 'nombre', 'name'], 'Dispositivo');
}

function deviceId(device) {
  return String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id'], '')).trim();
}

function deviceTechnicians(device) {
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

function stateClass(value) {
  const text = normalized(value);
  if (text.startsWith('si') || text === 'correcto') return 'is-good';
  return text ? 'is-warning' : 'is-empty';
}

function stateText(value) {
  return String(value || 'Sin estado').toUpperCase();
}

function parseAnswers(device) {
  try {
    return typeof device.RespuestasJSON === 'string'
      ? JSON.parse(device.RespuestasJSON || '{}')
      : device.RespuestasJSON || {};
  } catch {
    return {};
  }
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
  if (!details.length) return <div className="info-box"><Icon name="info" /><p>Este dispositivo no tiene campos adicionales configurados.</p></div>;

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

function isOffline(device) {
  return Boolean(device.OfflinePendiente)
    || (device.Imagenes || []).some((image) => Boolean(image.OfflinePendiente));
}

function hasOwnInteraction(target) {
  return Boolean(target?.closest?.('button, a, input, select, textarea, label, [data-no-device-toggle]'));
}

function toggleRowFromKeyboard(event, action) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  action();
}

function locationView(item = {}) {
  return {
    ...item,
    id: String(pick(item, ['id', 'UbicacionEquipoID', 'ubicacionEquipoId'], '')).trim(),
    name: String(pick(item, ['name', 'nombre', 'Nombre', 'UbicacionEquipoNombre'], 'Ubicación no disponible')).trim(),
    locationId: String(pick(item, ['locationId', 'UbicacionID', 'ubicacionId'], '')).trim(),
    locationName: String(pick(item, ['locationName', 'UbicacionNombre', 'ubicacionNombre'], '')).trim(),
    description: String(pick(item, ['description', 'Descripcion', 'descripcion'], '')).trim(),
    available: item.available !== false,
    active: item.active !== false,
    legacy: Boolean(item.legacy),
  };
}

function legacyGroupId(name) {
  return `legacy:${normalized(name).replace(/[^a-z0-9]+/g, '-') || 'sin-ubicacion'}`;
}

function buildGroups(locations, devices) {
  const map = new Map();
  locations.map(locationView).filter((item) => item.id).forEach((item) => {
    map.set(item.id, { ...item, items: [] });
  });

  devices.forEach((device) => {
    const locationId = deviceLocationId(device);
    const name = String(deviceLocationName(device) || 'Sin ubicación').trim() || 'Sin ubicación';
    const key = locationId || legacyGroupId(name);
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name,
        locationId: '',
        locationName: '',
        description: locationId ? 'Ubicación relacionada automáticamente desde un dispositivo existente.' : 'Registro histórico sin identificador de ubicación.',
        available: Boolean(locationId),
        active: Boolean(locationId),
        legacy: !locationId,
        items: [],
      });
    }
    map.get(key).items.push(device);
  });

  return [...map.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => naturalCompare(deviceName(left), deviceName(right))
        || naturalCompare(deviceType(left), deviceType(right))
        || naturalCompare(pick(left, ['Serie']), pick(right, ['Serie']))),
    }))
    .sort((left, right) => naturalCompare(left.locationName, right.locationName) || naturalCompare(left.name, right.name));
}

function uniqueTypes(devices) {
  return [...new Set(devices.map(deviceType).filter(Boolean))].sort(naturalCompare);
}

function FilterSelect({ label, value, onChange, children }) {
  return <label className="field-group"><span className="field-label">{label}</span><select className="form-control" value={value} onChange={onChange}>{children}</select></label>;
}

export default function MaintenanceLocationInventory({
  devices = [],
  locations = [],
  status,
  canEdit,
  sessionToken,
  onAddLocation,
  onRemoveLocation,
  onAddDevice,
  onEditDevice,
  onAddEvidence,
  onEditEvidence,
  projectMode = false,
  evidenceEnabled = true,
}) {
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [location, setLocation] = useState('TODAS');
  const [stateFilter, setStateFilter] = useState('TODOS');
  const [expandedDevice, setExpandedDevice] = useState('');
  const [detailDeviceId, setDetailDeviceId] = useState('');
  const [projectEvidenceTargetFilter, setProjectEvidenceTargetFilter] = useState('TODAS');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectionGroupId, setSelectionGroupId] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState(() => new Set());
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState({ done: 0, total: 0 });
  const [moveError, setMoveError] = useState('');
  const [moveNotice, setMoveNotice] = useState('');
  const [locationOverrides, setLocationOverrides] = useState(() => new Map());

  const canRemoveLocations = hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR');

  const effectiveDevices = useMemo(() => devices.map((device) => {
    const override = locationOverrides.get(deviceId(device));
    if (!override) return device;
    return {
      ...device,
      UbicacionEquipoID: override.id,
      ubicacionEquipoId: override.id,
      UbicacionEquipoNombre: override.name,
      equipmentLocationName: override.name,
      Zona: override.name,
    };
  }), [devices, locationOverrides]);

  const groups = useMemo(() => buildGroups(locations, effectiveDevices), [locations, effectiveDevices]);
  const categories = useMemo(() => uniqueTypes(effectiveDevices), [effectiveDevices]);
  const pending = status === 'PENDIENTE';

  useEffect(() => {
    setOpenGroups((current) => {
      const next = new Set([...current].filter((id) => groups.some((group) => group.id === id)));
      return next;
    });
  }, [groups]);

  useEffect(() => {
    setLocationOverrides((current) => {
      let changed = false;
      const next = new Map(current);
      devices.forEach((device) => {
        const id = deviceId(device);
        const override = next.get(id);
        if (override && deviceLocationId(device) === override.id) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [devices]);

  useEffect(() => {
    const validIds = new Set(effectiveDevices.map(deviceId).filter(Boolean));
    setSelectedDeviceIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  }, [effectiveDevices]);

  useEffect(() => {
    if (!selectionGroupId) return;
    const selectedGroup = groups.find((group) => group.id === selectionGroupId);
    if (!selectedGroup) {
      setSelectionGroupId('');
      setSelectedDeviceIds(new Set());
      setMoveTargetId('');
      return;
    }
    const targets = groups.filter((group) => group.id !== selectionGroupId && group.available && group.active && !group.legacy);
    if (!targets.some((group) => group.id === moveTargetId)) setMoveTargetId(targets[0]?.id || '');
  }, [groups, selectionGroupId, moveTargetId]);

  const visibleGroups = useMemo(() => {
    const search = normalized(query);
    return groups.map((group) => {
      const groupMatches = !search || [group.name, group.locationName, group.description].some((value) => normalized(value).includes(search));
      const items = group.items.filter((device) => {
        if (category !== 'TODAS' && normalized(deviceType(device)) !== normalized(category)) return false;
        if (stateFilter === 'CORRECTOS' && stateClass(pick(device, ['Estado'])) !== 'is-good') return false;
        if (stateFilter === 'ATENCION' && stateClass(pick(device, ['Estado'])) === 'is-good') return false;
        if (!search || groupMatches) return true;
        return [
          deviceName(device),
          deviceType(device),
          deviceLocationName(device),
          pick(device, ['Fabricante']),
          pick(device, ['Modelo']),
          pick(device, ['Serie']),
          pick(device, ['Estado']),
          pick(device, ['Observacion']),
          JSON.stringify(parseAnswers(device)),
          ...(device.Imagenes || []).flatMap((image) => [
            pick(image, ['Nota']),
            pick(image, ['Nombre']),
            pick(image, ['ProyectoComponenteNombre']),
            pick(image, ['ProyectoRelacionClave']),
          ]),
        ].some((value) => normalized(value).includes(search));
      });
      return { ...group, visibleItems: items, groupMatches };
    }).filter((group) => {
      if (location !== 'TODAS' && group.id !== location) return false;
      const deviceFilters = category !== 'TODAS' || stateFilter !== 'TODOS';
      if (deviceFilters && !group.visibleItems.length) return false;
      if (query.trim() && !group.groupMatches && !group.visibleItems.length) return false;
      return true;
    });
  }, [groups, query, category, location, stateFilter]);

  const filteredDeviceCount = visibleGroups.reduce((total, group) => total + group.visibleItems.length, 0);
  const activeFilterCount = Number(category !== 'TODAS') + Number(location !== 'TODAS') + Number(stateFilter !== 'TODOS');
  const projectDetailDevices = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const activeProjectDevice = useMemo(
    () => projectDetailDevices.find((device) => deviceId(device) === detailDeviceId) || null,
    [detailDeviceId, projectDetailDevices],
  );
  const activeProjectDeviceIndex = activeProjectDevice
    ? projectDetailDevices.findIndex((device) => deviceId(device) === detailDeviceId)
    : -1;

  function toggleGroup(group) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(group.id)) {
        next.delete(group.id);
        if (group.items.some((device) => deviceId(device) === expandedDevice)) setExpandedDevice('');
      } else next.add(group.id);
      return next;
    });
  }

  function openProjectDeviceDetail(device) {
    const id = deviceId(device);
    if (!id) return;
    setProjectEvidenceTargetFilter('TODAS');
    setDetailDeviceId(id);
  }

  function closeProjectDeviceDetail() {
    setDetailDeviceId('');
    setProjectEvidenceTargetFilter('TODAS');
  }

  function navigateProjectDevice(offset) {
    if (!projectDetailDevices.length || activeProjectDeviceIndex < 0) return;
    const nextIndex = activeProjectDeviceIndex + offset;
    if (nextIndex < 0 || nextIndex >= projectDetailDevices.length) return;
    setProjectEvidenceTargetFilter('TODAS');
    setDetailDeviceId(deviceId(projectDetailDevices[nextIndex]));
  }

  function toggleDevice(device) {
    if (projectMode) {
      openProjectDeviceDetail(device);
      return;
    }
    const id = deviceId(device);
    setExpandedDevice((current) => current === id ? '' : id);
  }

  function editDeviceFromDetail(device) {
    closeProjectDeviceDetail();
    onEditDevice?.(device);
  }

  function addEvidenceFromDetail(device) {
    closeProjectDeviceDetail();
    onAddEvidence?.(device);
  }

  function editEvidenceFromDetail(image, device) {
    closeProjectDeviceDetail();
    onEditEvidence?.(image, device);
  }

  function clearFilters() {
    setCategory('TODAS');
    setLocation('TODAS');
    setStateFilter('TODOS');
    setFilterOpen(false);
  }

  function selectedIdsForGroup(group) {
    return group.items.map(deviceId).filter((id) => id && selectedDeviceIds.has(id));
  }

  function toggleDeviceSelection(group, device) {
    if (moving) return;
    const id = deviceId(device);
    if (!id) return;
    setMoveError('');
    setMoveNotice('');
    if (selectionGroupId !== group.id) {
      setSelectionGroupId(group.id);
      setSelectedDeviceIds(new Set([id]));
      setMoveTargetId('');
      setOpenGroups((current) => new Set([...current, group.id]));
      return;
    }
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (!next.size) {
        setSelectionGroupId('');
        setMoveTargetId('');
      }
      return next;
    });
  }

  function toggleVisibleSelection(group) {
    if (moving) return;
    const ids = group.visibleItems.map(deviceId).filter(Boolean);
    if (!ids.length) return;
    setMoveError('');
    setMoveNotice('');
    if (selectionGroupId !== group.id) {
      setSelectionGroupId(group.id);
      setSelectedDeviceIds(new Set(ids));
      setMoveTargetId('');
      return;
    }
    const allSelected = ids.every((id) => selectedDeviceIds.has(id));
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      if (!next.size) {
        setSelectionGroupId('');
        setMoveTargetId('');
      }
      return next;
    });
  }

  async function moveSelectedDevices(group) {
    const selectedIds = selectedIdsForGroup(group);
    const target = groups.find((item) => item.id === moveTargetId && item.available && item.active && !item.legacy);
    if (!selectedIds.length || !target || target.id === group.id || moving) return;

    const selected = group.items.filter((device) => selectedIds.includes(deviceId(device)));
    const count = selected.length;
    if (!window.confirm(`¿Mover ${count} dispositivo${count === 1 ? '' : 's'} de “${group.name}” a “${target.name}”?`)) return;

    setMoving(true);
    setMoveProgress({ done: 0, total: count });
    setMoveError('');
    setMoveNotice('');
    const moved = [];
    const failed = [];

    for (let index = 0; index < selected.length; index += 1) {
      const device = selected[index];
      const id = deviceId(device);
      try {
        await requestAvailable(MODULE_ROUTES.maintenance.deviceUpdate, {
          deviceId: id,
          EvidenciaMantenimientoID: id,
          maintenanceId: pick(device, ['MantenimientoRef', 'maintenanceId']),
          MantenimientoID: pick(device, ['MantenimientoRef', 'maintenanceId']),
          UbicacionEquipoID: target.id,
          ubicacionEquipoId: target.id,
          UbicacionEquipoNombre: target.name,
          ubicacionEquipoNombre: target.name,
          Zona: target.name,
          zona: target.name,
        }, sessionToken);
        moved.push(device);
      } catch (error) {
        failed.push({ device, message: error.message || 'Error desconocido' });
      }
      setMoveProgress({ done: index + 1, total: count });
    }

    if (moved.length) {
      setLocationOverrides((current) => {
        const next = new Map(current);
        moved.forEach((device) => next.set(deviceId(device), { id: target.id, name: target.name }));
        return next;
      });
      setOpenGroups((current) => new Set([...current, target.id]));
      setExpandedDevice('');
      setMoveNotice(`${moved.length} dispositivo${moved.length === 1 ? '' : 's'} movido${moved.length === 1 ? '' : 's'} a “${target.name}”.`);
      window.dispatchEvent(new CustomEvent('dms-offline-queue-change'));
    }

    const failedIds = new Set(failed.map(({ device }) => deviceId(device)));
    setSelectedDeviceIds(failedIds);
    if (!failedIds.size) {
      setSelectionGroupId('');
      setMoveTargetId('');
    }
    if (failed.length) {
      setMoveError(`No se pudieron mover ${failed.length} dispositivo${failed.length === 1 ? '' : 's'}: ${failed.map(({ device }) => deviceName(device)).join(', ')}.`);
    }
    setMoving(false);
  }

  function expandedContent(device, { detailView = false } = {}) {
    const config = getMaintenanceCategory(deviceType(device));
    const answers = parseAnswers(device);
    const allImages = sortedEvidence(device.Imagenes || []);
    const targetOptions = projectMode ? projectEvidenceTargets(device) : [];
    const images = projectMode && detailView && projectEvidenceTargetFilter !== 'TODAS'
      ? allImages.filter((image) => projectEvidenceTargetValue(image) === projectEvidenceTargetFilter)
      : allImages;
    const id = deviceId(device);
    return <div className={`maintenance-inventory-expanded${detailView ? ' maintenance-project-device-detail-content' : ''}`}>
      <div className="maintenance-inventory-expanded__heading">
        <div><span className="eyebrow">Detalle del dispositivo</span><strong>{deviceName(device)}</strong></div>
        {pending && canEdit && <button className="button button--secondary button--compact" type="button" onClick={() => detailView ? editDeviceFromDetail(device) : onEditDevice(device)}><Icon name="edit" />Editar dispositivo</button>}
      </div>
      {projectMode && <div className="maintenance-project-device-summary-grid">
        <div><span>Tipo</span><strong>{deviceType(device)}</strong></div>
        <div><span>Ubicación</span><strong>{deviceLocationName(device)}</strong></div>
        <div><span>Marca</span><strong>{pick(device, ['Fabricante'], 'Sin dato')}</strong></div>
        <div><span>Modelo</span><strong>{pick(device, ['Modelo'], 'Sin dato')}</strong></div>
        <div><span>Serie</span><strong>{pick(device, ['Serie'], 'Sin dato')}</strong></div>
        <div><span>Dirección MAC</span><strong>{pick(device, ['DireccionMAC', 'macAddress'], 'Sin dato')}</strong></div>
        <div><span>Fecha de trabajo</span><strong>{pick(device, ['FechaTrabajo'], 'Sin dato')}</strong></div>
        <div><span>Técnicos</span><strong>{deviceTechnicians(device)}</strong></div>
        <div><span>Estado</span><strong>{stateText(pick(device, ['Estado']))}</strong></div>
        <div><span>Evidencias</span><strong>{allImages.length}</strong></div>
      </div>}
      {projectMode
        ? <ProjectDeviceAnswers device={device} />
        : <div className="maintenance-inventory-checklist">
          <div className={stateClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
          <div className={stateClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
          {config.questions.map(([key, label]) => <div className={stateClass(answers[key])} key={key}><span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong></div>)}
        </div>}
      {pick(device, ['Observacion']) && <div className="maintenance-inventory-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}
      <div className="maintenance-inventory-evidence-heading">
        <div><strong>Evidencias</strong><span>{images.length} de {allImages.length} archivo{allImages.length === 1 ? '' : 's'} · más reciente primero</span></div>
        <div className="maintenance-project-evidence-heading-actions">
          {projectMode && detailView && targetOptions.length > 1 && <label className="maintenance-project-evidence-filter"><span>Mostrar</span><select value={projectEvidenceTargetFilter} onChange={(event) => setProjectEvidenceTargetFilter(event.target.value)}><option value="TODAS">Todas las evidencias</option>{targetOptions.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>}
          {evidenceEnabled && pending && canEdit && onAddEvidence && <button className="button button--secondary button--compact" type="button" onClick={() => detailView ? addEvidenceFromDetail(device) : onAddEvidence(device)}><Icon name="add_a_photo" />Agregar</button>}
        </div>
      </div>
      {evidenceEnabled && <div className="maintenance-inventory-images">
        {images.map((image) => <figure key={pick(image, ['FotoDispositivoID', 'id'])}><MaintenanceEvidenceImage image={image} galleryImages={images} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} /><figcaption>{projectMode ? <><strong>{projectEvidenceLabel(device, image)}</strong><span>{evidenceDateLabel(image)}</span><span>{pick(image, ['Nota'], 'Sin nota')}</span></> : <><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></>}</figcaption>{evidenceEnabled && pending && canEdit && onEditEvidence && <button type="button" onClick={() => detailView ? editEvidenceFromDetail(image, device) : onEditEvidence(image, device)}><Icon name="edit" />Editar evidencia</button>}</figure>)}
        {!images.length && <div className="maintenance-inventory-no-images"><Icon name="photo_library" /><span>Sin fotografías registradas.</span></div>}
      </div>}
      {!evidenceEnabled && <div className="info-box"><Icon name="photo_library" /><p>La carga de evidencias no está disponible en esta vista.</p></div>}
      {isOffline(device) && <div className="maintenance-inventory-offline-note"><Icon name="cloud_off" />Este dispositivo y sus evidencias están guardados en este equipo y se enviarán al recuperar conexión.</div>}
      <span className="maintenance-inventory-device-id">ID: {id}</span>
    </div>;
  }

  const drawerFields = <>
    <FilterSelect label="Tipo de dispositivo" value={category} onChange={(event) => setCategory(event.target.value)}><option value="TODAS">Todos los tipos</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</FilterSelect>
    <FilterSelect label="Ubicación del equipo" value={location} onChange={(event) => setLocation(event.target.value)}><option value="TODAS">Todas las ubicaciones</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.locationName ? `${group.locationName} · ` : ''}{group.name}</option>)}</FilterSelect>
    <FilterSelect label="Estado" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="TODOS">Todos los estados</option><option value="CORRECTOS">Correctos</option><option value="ATENCION">Requieren atención</option></FilterSelect>
  </>;

  return <section className="maintenance-inventory-panel maintenance-location-inventory">
    <div className="maintenance-inventory-heading">
      <div><span className="eyebrow">{projectMode ? 'INVENTARIO DEL PROYECTO' : 'INVENTARIO TÉCNICO'}</span><h2>Ubicaciones y dispositivos</h2><p>{projectMode ? 'Registre los dispositivos principales y consulte sus componentes relacionados dentro de cada ubicación.' : 'Primero agregue las ubicaciones del mantenimiento y luego registre los equipos dentro de cada una.'}</p></div>
      {pending && canEdit && <button className="button button--primary" type="button" onClick={onAddLocation}><Icon name="add_location_alt" />Agregar ubicación</button>}
    </div>

    {moveError && <div className="alert alert--error maintenance-bulk-move-message" role="alert"><Icon name="error" /><span>{moveError}</span></div>}
    {moveNotice && <div className="alert alert--success maintenance-bulk-move-message" role="status"><Icon name="check_circle" /><span>{moveNotice}</span></div>}

    {groups.length > 0 && <>
      <div className="maintenance-device-toolbar maintenance-device-toolbar--detail">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar dispositivo, modelo, serie, componente o nota de evidencia..." /></label>
        <button type="button" className="icon-button icon-button--primary maintenance-inventory-filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros"><Icon name="tune" />{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
        <select className="maintenance-inventory-inline-filter" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por tipo"><option value="TODAS">Todos los tipos</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filtrar por ubicación"><option value="TODAS">Todas las ubicaciones</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="CORRECTOS">Correctos</option><option value="ATENCION">Requieren atención</option></select>
      </div>

      <div className="maintenance-device-category-chips"><button type="button" className={category === 'TODAS' ? 'is-active' : ''} onClick={() => setCategory('TODAS')}>Todos <span>{effectiveDevices.length}</span></button>{categories.map((name) => <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name} <span>{effectiveDevices.filter((item) => normalized(deviceType(item)) === normalized(name)).length}</span></button>)}</div>

      {(category !== 'TODAS' || location !== 'TODAS' || stateFilter !== 'TODOS') && <div className="maintenance-inventory-active-filters" aria-live="polite"><span><strong>{filteredDeviceCount}</strong> de {effectiveDevices.length} dispositivos</span>{category !== 'TODAS' && <button type="button" onClick={() => setCategory('TODAS')}><Icon name="devices_other" />{category}<Icon name="close" /></button>}{location !== 'TODAS' && <button type="button" onClick={() => setLocation('TODAS')}><Icon name="location_on" />{groups.find((group) => group.id === location)?.name || 'Ubicación'}<Icon name="close" /></button>}{stateFilter !== 'TODOS' && <button type="button" onClick={() => setStateFilter('TODOS')}><Icon name="rule" />{stateFilter === 'CORRECTOS' ? 'Correctos' : 'Requieren atención'}<Icon name="close" /></button>}</div>}
    </>}

    {visibleGroups.length ? <div className="maintenance-location-groups-list">
      {visibleGroups.map((group) => {
        const open = openGroups.has(group.id);
        const usedCount = group.items.length;
        const groupSelectedIds = selectedIdsForGroup(group);
        const visibleIds = group.visibleItems.map(deviceId).filter(Boolean);
        const allVisibleSelected = selectionGroupId === group.id && visibleIds.length > 0 && visibleIds.every((id) => selectedDeviceIds.has(id));
        const moveTargets = groups.filter((item) => item.id !== group.id && item.available && item.active && !item.legacy);
        return <section className={`maintenance-location-work-group${open ? ' is-open' : ''}${!group.available ? ' is-unavailable' : ''}${groupSelectedIds.length ? ' has-selection' : ''}`} key={group.id}>
          <div className="maintenance-location-work-group__header">
            <button className="maintenance-location-work-group__toggle" type="button" onClick={() => toggleGroup(group)} aria-expanded={open}>
              <span className="maintenance-location-work-group__icon"><Icon name="location_on" /></span>
              <span className="maintenance-location-work-group__text"><strong>{group.name}</strong><small>{group.locationName ? `${group.locationName} · ` : ''}{usedCount} dispositivo{usedCount === 1 ? '' : 's'}{!group.available ? ' · Ubicación histórica o eliminada' : ''}</small></span>
              <Icon name={open ? 'expand_less' : 'expand_more'} />
            </button>
            {pending && canEdit && <div className="maintenance-location-work-group__actions">
              {group.available && !group.legacy && <button className="button button--primary button--compact" type="button" onClick={() => onAddDevice(group)} disabled={moving}><Icon name="add" />Agregar dispositivo</button>}
              {canRemoveLocations && !group.legacy && <button className="icon-button icon-button--danger" type="button" onClick={() => onRemoveLocation(group)} disabled={usedCount > 0 || moving} title={usedCount > 0 ? 'Mueva o elimine primero los dispositivos de esta ubicación' : 'Quitar ubicación del mantenimiento'} aria-label={`Quitar ${group.name}`}><Icon name="delete" /></button>}
            </div>}
          </div>

          {open && <div className="maintenance-location-work-group__content">
            {pending && canEdit && group.items.length > 0 && <div className="maintenance-device-bulk-move-toolbar">
              <label className="maintenance-device-bulk-select-all">
                <input type="checkbox" checked={allVisibleSelected} onChange={() => toggleVisibleSelection(group)} disabled={moving || !visibleIds.length} />
                <Icon name={allVisibleSelected ? 'check_box' : groupSelectedIds.length ? 'indeterminate_check_box' : 'check_box_outline_blank'} />
                <span>{allVisibleSelected ? 'Deseleccionar visibles' : 'Seleccionar dispositivos visibles'}</span>
              </label>
              <span className="maintenance-device-bulk-count">{groupSelectedIds.length} seleccionado{groupSelectedIds.length === 1 ? '' : 's'}</span>
              <label className="maintenance-device-bulk-target"><span>Mover a</span><select className="form-control" value={selectionGroupId === group.id ? moveTargetId : ''} onChange={(event) => { setSelectionGroupId(group.id); setMoveTargetId(event.target.value); }} disabled={moving || !groupSelectedIds.length || !moveTargets.length}><option value="">Seleccione destino</option>{moveTargets.map((target) => <option key={target.id} value={target.id}>{target.locationName ? `${target.locationName} · ` : ''}{target.name}</option>)}</select></label>
              <button className="button button--primary button--compact" type="button" onClick={() => moveSelectedDevices(group)} disabled={moving || !groupSelectedIds.length || !moveTargetId || moveTargetId === group.id}><Icon name={moving && selectionGroupId === group.id ? 'progress_activity' : 'drive_file_move'} />{moving && selectionGroupId === group.id ? `Moviendo ${moveProgress.done}/${moveProgress.total}` : 'Mover seleccionados'}</button>
              {!moveTargets.length && <small className="maintenance-device-bulk-hint">Agregue otra ubicación activa al mantenimiento para poder mover dispositivos.</small>}
            </div>}

            {group.visibleItems.length ? <>
              <div className="maintenance-location-device-table-wrap"><table className="maintenance-inventory-table maintenance-location-device-table"><thead><tr>{pending && canEdit && <th className="maintenance-device-selection-column">Sel.</th>}<th>Nombre</th><th>Tipo</th><th>Modelo / Serie</th><th>Estado</th><th>{projectMode ? 'Evidencias' : 'Fotos'}</th><th>Acciones</th></tr></thead><tbody>{group.visibleItems.map((device) => {
                const id = deviceId(device);
                const expanded = !projectMode && expandedDevice === id;
                const images = sortedEvidence(device.Imagenes || []);
                const selected = selectionGroupId === group.id && selectedDeviceIds.has(id);
                return <React.Fragment key={id}><tr
                  data-device-row
                  className={`${expanded ? 'is-expanded' : ''}${selected ? ' is-selected-for-move' : ''}`}
                  tabIndex="0"
                  aria-expanded={projectMode ? undefined : expanded}
                  onClick={(event) => { if (!hasOwnInteraction(event.target)) toggleDevice(device); }}
                  onKeyDown={(event) => toggleRowFromKeyboard(event, () => toggleDevice(device))}
                >{pending && canEdit && <td className="maintenance-device-selection-cell"><label title={`Seleccionar ${deviceName(device)}`}><input type="checkbox" checked={selected} onChange={() => toggleDeviceSelection(group, device)} disabled={moving || !id} /><Icon name={selected ? 'check_box' : 'check_box_outline_blank'} /></label></td>}<td><button type="button" className="maintenance-inventory-name" onClick={() => toggleDevice(device)}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span><span><strong>{deviceName(device)}</strong>{isOffline(device) && <small><Icon name="cloud_off" />Offline</small>}</span></button></td><td>{deviceType(device)}</td><td>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin datos'}</td><td><span className={`maintenance-device-compact-state ${stateClass(pick(device, ['Estado']))}`}>{stateText(pick(device, ['Estado']))}</span></td><td><span className="maintenance-device-evidence-count"><Icon name="photo_library" />{images.length}</span></td><td><div className="maintenance-inventory-row-actions">{pending && canEdit && <button type="button" className="icon-button" onClick={() => onEditDevice(device)} aria-label={`Editar ${deviceName(device)}`} disabled={moving}><Icon name="edit" /></button>}<button type="button" className="icon-button" onClick={() => toggleDevice(device)} aria-expanded={projectMode ? undefined : expanded} aria-label={`Ver detalle de ${deviceName(device)}`}><Icon name={projectMode ? 'open_in_new' : (expanded ? 'expand_less' : 'expand_more')} /></button></div></td></tr>{expanded && <tr className="maintenance-inventory-expanded-row"><td colSpan={pending && canEdit ? 7 : 6}>{expandedContent(device)}</td></tr>}</React.Fragment>;
              })}</tbody></table></div>

              <div className="maintenance-inventory-mobile-list maintenance-location-mobile-devices">{group.visibleItems.map((device) => {
                const id = deviceId(device);
                const expanded = !projectMode && expandedDevice === id;
                const selected = selectionGroupId === group.id && selectedDeviceIds.has(id);
                return <article key={id} className={`maintenance-inventory-mobile-card${expanded ? ' is-expanded' : ''}${selected ? ' is-selected-for-move' : ''}`}>{pending && canEdit && <label className="maintenance-device-mobile-selection" title={`Seleccionar ${deviceName(device)}`}><input type="checkbox" checked={selected} onChange={() => toggleDeviceSelection(group, device)} disabled={moving || !id} /><Icon name={selected ? 'check_box' : 'check_box_outline_blank'} /><span>Seleccionar</span></label>}<button type="button" className="maintenance-inventory-mobile-toggle" onClick={() => toggleDevice(device)} aria-expanded={projectMode ? undefined : expanded}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span><span><strong>{deviceName(device)}</strong><small>{deviceType(device)} · {[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin modelo o serie'}</small><span><em className={stateClass(pick(device, ['Estado']))}>{stateText(pick(device, ['Estado']))}</em><em><Icon name="photo_library" />{(device.Imagenes || []).length}</em>{isOffline(device) && <em className="is-offline"><Icon name="cloud_off" />Offline</em>}</span></span><Icon name={projectMode ? 'open_in_new' : (expanded ? 'expand_less' : 'expand_more')} /></button>{pending && canEdit && <button type="button" className="maintenance-inventory-mobile-edit" onClick={() => onEditDevice(device)} disabled={moving}><Icon name="edit" />Editar dispositivo y evidencias</button>}{expanded && expandedContent(device)}</article>;
              })}</div>
            </> : <div className="maintenance-location-work-group__empty"><Icon name="devices_other" /><div><strong>{group.items.length ? 'No hay dispositivos que coincidan con los filtros' : 'Ubicación sin dispositivos'}</strong><span>{group.items.length ? 'Cambie los filtros para mostrar otros equipos.' : 'Agregue el primer dispositivo y la ubicación ya vendrá seleccionada.'}</span></div>{pending && canEdit && group.available && !group.legacy && !group.items.length && <button className="button button--primary button--compact" type="button" onClick={() => onAddDevice(group)}><Icon name="add" />Agregar dispositivo</button>}</div>}
          </div>}
        </section>;
      })}
    </div> : <div className="empty-state maintenance-device-empty"><Icon name={groups.length ? 'filter_alt_off' : 'add_location_alt'} /><h2>{groups.length ? 'No hay coincidencias' : 'Sin ubicaciones agregadas'}</h2><p>{groups.length ? 'Cambie la búsqueda o los filtros para mostrar otras ubicaciones.' : 'Agregue primero una ubicación del equipo. Después podrá registrar sus dispositivos dentro de ella.'}</p>{pending && canEdit && !groups.length && <button className="button button--primary" type="button" onClick={onAddLocation}><Icon name="add_location_alt" />Agregar primera ubicación</button>}</div>}

    <FilterDrawer open={filterOpen} title="Filtros de dispositivos" onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)} onClear={clearFilters}>{drawerFields}</FilterDrawer>

    {projectMode && activeProjectDevice && <AdminEntityModal
      open
      title={deviceName(activeProjectDevice)}
      subtitle={`${deviceType(activeProjectDevice)} · ${deviceLocationName(activeProjectDevice)} · ${activeProjectDeviceIndex + 1} de ${projectDetailDevices.length}`}
      eyebrow="Detalle del dispositivo"
      icon={getMaintenanceCategory(deviceType(activeProjectDevice)).icon}
      className="maintenance-project-device-detail-modal"
      onClose={closeProjectDeviceDetail}
      footer={<div className="maintenance-project-device-detail-navigation">
        <button className="button button--secondary maintenance-project-device-detail-navigation__previous" type="button" onClick={() => navigateProjectDevice(-1)} disabled={activeProjectDeviceIndex <= 0}><Icon name="arrow_back" />Anterior</button>
        <span><strong>{activeProjectDeviceIndex + 1}</strong> / {projectDetailDevices.length}</span>
        {pending && canEdit && <button className="button button--primary maintenance-project-device-detail-navigation__edit" type="button" onClick={() => editDeviceFromDetail(activeProjectDevice)}><Icon name="edit" />Editar</button>}
        <button className="button button--secondary maintenance-project-device-detail-navigation__next" type="button" onClick={() => navigateProjectDevice(1)} disabled={activeProjectDeviceIndex < 0 || activeProjectDeviceIndex >= projectDetailDevices.length - 1}>Siguiente<Icon name="arrow_forward" /></button>
      </div>}
    >
      {expandedContent(activeProjectDevice, { detailView: true })}
    </AdminEntityModal>}
  </section>;
}
