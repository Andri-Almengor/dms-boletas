import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import FilterDrawer from '../forms/FilterDrawer';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';

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
  return String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
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

function isOffline(device) {
  return Boolean(device.OfflinePendiente)
    || (device.Imagenes || []).some((image) => Boolean(image.OfflinePendiente));
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
    .map((group) => ({ ...group, items: [...group.items].sort((left, right) => naturalCompare(deviceName(left), deviceName(right)) || naturalCompare(deviceType(left), deviceType(right)) || naturalCompare(pick(left, ['Serie']), pick(right, ['Serie']))) }))
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
}) {
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [location, setLocation] = useState('TODAS');
  const [stateFilter, setStateFilter] = useState('TODOS');
  const [expandedDevice, setExpandedDevice] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const canRemoveLocations = hasPermission('USUARIOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const groups = useMemo(() => buildGroups(locations, devices), [locations, devices]);
  const categories = useMemo(() => uniqueTypes(devices), [devices]);
  const pending = status === 'PENDIENTE';

  useEffect(() => {
    setOpenGroups((current) => {
      const next = new Set([...current].filter((id) => groups.some((group) => group.id === id)));
      return next;
    });
  }, [groups]);

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

  function toggleDevice(device) {
    const id = deviceId(device);
    setExpandedDevice((current) => current === id ? '' : id);
  }

  function clearFilters() {
    setCategory('TODAS');
    setLocation('TODAS');
    setStateFilter('TODOS');
    setFilterOpen(false);
  }

  function expandedContent(device) {
    const config = getMaintenanceCategory(deviceType(device));
    const answers = parseAnswers(device);
    const images = device.Imagenes || [];
    const id = deviceId(device);
    return <div className="maintenance-inventory-expanded">
      <div className="maintenance-inventory-expanded__heading">
        <div><span className="eyebrow">Detalle del dispositivo</span><strong>{deviceName(device)}</strong></div>
        {pending && canEdit && <button className="button button--secondary button--compact" type="button" onClick={() => onEditDevice(device)}><Icon name="edit" />Editar dispositivo</button>}
      </div>
      <div className="maintenance-inventory-checklist">
        <div className={stateClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
        <div className={stateClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
        {config.questions.map(([key, label]) => <div className={stateClass(answers[key])} key={key}><span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong></div>)}
      </div>
      {pick(device, ['Observacion']) && <div className="maintenance-inventory-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}
      <div className="maintenance-inventory-evidence-heading"><div><strong>Evidencias</strong><span>{images.length} fotografía{images.length === 1 ? '' : 's'}</span></div>{pending && canEdit && <button className="button button--secondary button--compact" type="button" onClick={() => onAddEvidence(device)}><Icon name="add_a_photo" />Agregar</button>}</div>
      <div className="maintenance-inventory-images">
        {images.map((image) => <figure key={pick(image, ['FotoDispositivoID', 'id'])}><MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} /><figcaption><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>{pending && canEdit && <button type="button" onClick={() => onEditEvidence(image, device)}><Icon name="edit" />Editar evidencia</button>}</figure>)}
        {!images.length && <div className="maintenance-inventory-no-images"><Icon name="photo_library" /><span>Sin fotografías registradas.</span></div>}
      </div>
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
      <div><span className="eyebrow">INVENTARIO TÉCNICO</span><h2>Ubicaciones y dispositivos</h2><p>Primero agregue las ubicaciones del mantenimiento y luego registre los equipos dentro de cada una.</p></div>
      {pending && canEdit && <button className="button button--primary" type="button" onClick={onAddLocation}><Icon name="add_location_alt" />Agregar ubicación</button>}
    </div>

    {groups.length > 0 && <>
      <div className="maintenance-device-toolbar maintenance-device-toolbar--detail">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ubicación, dispositivo, tipo, modelo o serie..." /></label>
        <button type="button" className="icon-button icon-button--primary maintenance-inventory-filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros"><Icon name="tune" />{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
        <select className="maintenance-inventory-inline-filter" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por tipo"><option value="TODAS">Todos los tipos</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filtrar por ubicación"><option value="TODAS">Todas las ubicaciones</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="CORRECTOS">Correctos</option><option value="ATENCION">Requieren atención</option></select>
      </div>

      <div className="maintenance-device-category-chips"><button type="button" className={category === 'TODAS' ? 'is-active' : ''} onClick={() => setCategory('TODAS')}>Todos <span>{devices.length}</span></button>{categories.map((name) => <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name} <span>{devices.filter((item) => normalized(deviceType(item)) === normalized(name)).length}</span></button>)}</div>

      {(category !== 'TODAS' || location !== 'TODAS' || stateFilter !== 'TODOS') && <div className="maintenance-inventory-active-filters" aria-live="polite"><span><strong>{filteredDeviceCount}</strong> de {devices.length} dispositivos</span>{category !== 'TODAS' && <button type="button" onClick={() => setCategory('TODAS')}><Icon name="devices_other" />{category}<Icon name="close" /></button>}{location !== 'TODAS' && <button type="button" onClick={() => setLocation('TODAS')}><Icon name="location_on" />{groups.find((group) => group.id === location)?.name || 'Ubicación'}<Icon name="close" /></button>}{stateFilter !== 'TODOS' && <button type="button" onClick={() => setStateFilter('TODOS')}><Icon name="rule" />{stateFilter === 'CORRECTOS' ? 'Correctos' : 'Requieren atención'}<Icon name="close" /></button>}</div>}
    </>}

    {visibleGroups.length ? <div className="maintenance-location-groups-list">
      {visibleGroups.map((group) => {
        const open = openGroups.has(group.id);
        const usedCount = group.items.length;
        return <section className={`maintenance-location-work-group${open ? ' is-open' : ''}${!group.available ? ' is-unavailable' : ''}`} key={group.id}>
          <div className="maintenance-location-work-group__header">
            <button className="maintenance-location-work-group__toggle" type="button" onClick={() => toggleGroup(group)} aria-expanded={open}>
              <span className="maintenance-location-work-group__icon"><Icon name="location_on" /></span>
              <span className="maintenance-location-work-group__text"><strong>{group.name}</strong><small>{group.locationName ? `${group.locationName} · ` : ''}{usedCount} dispositivo{usedCount === 1 ? '' : 's'}{!group.available ? ' · Ubicación histórica o eliminada' : ''}</small></span>
              <Icon name={open ? 'expand_less' : 'expand_more'} />
            </button>
            {pending && canEdit && <div className="maintenance-location-work-group__actions">
              {group.available && !group.legacy && <button className="button button--primary button--compact" type="button" onClick={() => onAddDevice(group)}><Icon name="add" />Agregar dispositivo</button>}
              {canRemoveLocations && !group.legacy && <button className="icon-button icon-button--danger" type="button" onClick={() => onRemoveLocation(group)} disabled={usedCount > 0} title={usedCount > 0 ? 'Mueva o elimine primero los dispositivos de esta ubicación' : 'Quitar ubicación del mantenimiento'} aria-label={`Quitar ${group.name}`}><Icon name="delete" /></button>}
            </div>}
          </div>

          {open && <div className="maintenance-location-work-group__content">
            {group.visibleItems.length ? <>
              <div className="maintenance-location-device-table-wrap"><table className="maintenance-inventory-table maintenance-location-device-table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Modelo / Serie</th><th>Estado</th><th>Fotos</th><th>Acciones</th></tr></thead><tbody>{group.visibleItems.map((device) => {
                const id = deviceId(device);
                const expanded = expandedDevice === id;
                const images = device.Imagenes || [];
                return <React.Fragment key={id}><tr className={expanded ? 'is-expanded' : ''}><td><button type="button" className="maintenance-inventory-name" onClick={() => toggleDevice(device)}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span><span><strong>{deviceName(device)}</strong>{isOffline(device) && <small><Icon name="cloud_off" />Offline</small>}</span></button></td><td>{deviceType(device)}</td><td>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin datos'}</td><td><span className={`maintenance-device-compact-state ${stateClass(pick(device, ['Estado']))}`}>{stateText(pick(device, ['Estado']))}</span></td><td><span className="maintenance-device-evidence-count"><Icon name="photo_library" />{images.length}</span></td><td><div className="maintenance-inventory-row-actions">{pending && canEdit && <button type="button" className="icon-button" onClick={() => onEditDevice(device)} aria-label={`Editar ${deviceName(device)}`}><Icon name="edit" /></button>}<button type="button" className="icon-button" onClick={() => toggleDevice(device)} aria-expanded={expanded} aria-label={`Ver detalle de ${deviceName(device)}`}><Icon name={expanded ? 'expand_less' : 'expand_more'} /></button></div></td></tr>{expanded && <tr className="maintenance-inventory-expanded-row"><td colSpan="6">{expandedContent(device)}</td></tr>}</React.Fragment>;
              })}</tbody></table></div>

              <div className="maintenance-inventory-mobile-list maintenance-location-mobile-devices">{group.visibleItems.map((device) => {
                const id = deviceId(device);
                const expanded = expandedDevice === id;
                return <article key={id} className={`maintenance-inventory-mobile-card${expanded ? ' is-expanded' : ''}`}><button type="button" className="maintenance-inventory-mobile-toggle" onClick={() => toggleDevice(device)} aria-expanded={expanded}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(deviceType(device)).icon} /></span><span><strong>{deviceName(device)}</strong><small>{deviceType(device)} · {[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin modelo o serie'}</small><span><em className={stateClass(pick(device, ['Estado']))}>{stateText(pick(device, ['Estado']))}</em><em><Icon name="photo_library" />{(device.Imagenes || []).length}</em>{isOffline(device) && <em className="is-offline"><Icon name="cloud_off" />Offline</em>}</span></span><Icon name={expanded ? 'expand_less' : 'expand_more'} /></button>{pending && canEdit && <button type="button" className="maintenance-inventory-mobile-edit" onClick={() => onEditDevice(device)}><Icon name="edit" />Editar dispositivo y evidencias</button>}{expanded && expandedContent(device)}</article>;
              })}</div>
            </> : <div className="maintenance-location-work-group__empty"><Icon name="devices_other" /><div><strong>{group.items.length ? 'No hay dispositivos que coincidan con los filtros' : 'Ubicación sin dispositivos'}</strong><span>{group.items.length ? 'Cambie los filtros para mostrar otros equipos.' : 'Agregue el primer dispositivo y la ubicación ya vendrá seleccionada.'}</span></div>{pending && canEdit && group.available && !group.legacy && !group.items.length && <button className="button button--primary button--compact" type="button" onClick={() => onAddDevice(group)}><Icon name="add" />Agregar dispositivo</button>}</div>}
          </div>}
        </section>;
      })}
    </div> : <div className="empty-state maintenance-device-empty"><Icon name={groups.length ? 'filter_alt_off' : 'add_location_alt'} /><h2>{groups.length ? 'No hay coincidencias' : 'Sin ubicaciones agregadas'}</h2><p>{groups.length ? 'Cambie la búsqueda o los filtros para mostrar otras ubicaciones.' : 'Agregue primero una ubicación del equipo. Después podrá registrar sus dispositivos dentro de ella.'}</p>{pending && canEdit && !groups.length && <button className="button button--primary" type="button" onClick={onAddLocation}><Icon name="add_location_alt" />Agregar primera ubicación</button>}</div>}

    <FilterDrawer open={filterOpen} title="Filtros de dispositivos" onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)} onClear={clearFilters}>{drawerFields}</FilterDrawer>
  </section>;
}
