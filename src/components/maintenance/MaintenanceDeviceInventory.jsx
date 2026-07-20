import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import FilterDrawer from '../forms/FilterDrawer';
import MaintenanceEvidenceImage from './MaintenanceEvidenceImage';
import { getMaintenanceCategory } from '../../config/maintenanceCategories';
import { pick } from '../../services/moduleApi';

const PAGE_SIZES = [25, 50, 100];

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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

function deviceId(device) {
  return String(pick(device, ['EvidenciaMantenimientoID', 'deviceId', 'id']));
}

function isOffline(device) {
  return Boolean(device.OfflinePendiente)
    || (device.Imagenes || []).some((image) => Boolean(image.OfflinePendiente));
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      <select className="form-control" value={value} onChange={onChange}>{children}</select>
    </label>
  );
}

export default function MaintenanceDeviceInventory({
  devices,
  status,
  canEdit,
  sessionToken,
  onAddDevice,
  onEditDevice,
  onAddEvidence,
  onEditEvidence,
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [stateFilter, setStateFilter] = useState('TODOS');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const categories = useMemo(() => [...new Set(devices.map((item) => pick(item, ['Categoria'], 'Sin categoría')))]
    .sort((a, b) => String(a).localeCompare(String(b), 'es')), [devices]);

  const filtered = useMemo(() => {
    const search = normalized(query);
    return devices.filter((device) => {
      const currentCategory = pick(device, ['Categoria'], 'Sin categoría');
      const currentState = stateClass(pick(device, ['Estado']));
      if (category !== 'TODAS' && currentCategory !== category) return false;
      if (stateFilter === 'CORRECTOS' && currentState !== 'is-good') return false;
      if (stateFilter === 'ATENCION' && currentState === 'is-good') return false;
      if (!search) return true;
      return [
        pick(device, ['NombreDispositivo']),
        currentCategory,
        pick(device, ['Zona']),
        pick(device, ['Fabricante']),
        pick(device, ['Modelo']),
        pick(device, ['Serie']),
        pick(device, ['Estado']),
        pick(device, ['Observacion']),
      ].some((value) => normalized(value).includes(search));
    });
  }, [devices, query, category, stateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pending = status === 'PENDIENTE';
  const activeFilterCount = Number(category !== 'TODAS') + Number(stateFilter !== 'TODOS') + Number(pageSize !== 25);

  useEffect(() => { setPage(1); }, [query, category, stateFilter, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  function toggle(device) {
    const id = deviceId(device);
    setExpanded((current) => current === id ? '' : id);
  }

  function clearFilters() {
    setCategory('TODAS');
    setStateFilter('TODOS');
    setPageSize(25);
    setFilterOpen(false);
  }

  function expandedContent(device) {
    const categoryName = pick(device, ['Categoria'], 'Sin categoría');
    const config = getMaintenanceCategory(categoryName);
    const answers = parseAnswers(device);
    const images = device.Imagenes || [];
    const id = deviceId(device);
    return (
      <div className="maintenance-inventory-expanded">
        <div className="maintenance-inventory-expanded__heading">
          <div>
            <span className="eyebrow">Detalle del dispositivo</span>
            <strong>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</strong>
          </div>
          {pending && canEdit && (
            <button className="button button--secondary button--compact" type="button" onClick={() => onEditDevice(device)}>
              <Icon name="edit" />Editar dispositivo
            </button>
          )}
        </div>
        <div className="maintenance-inventory-checklist">
          <div className={stateClass(pick(device, ['Funcionamiento']))}><span>Funcionamiento</span><strong>{pick(device, ['Funcionamiento'], 'Sin responder')}</strong></div>
          <div className={stateClass(pick(device, ['EnUso']))}><span>En uso</span><strong>{pick(device, ['EnUso'], 'Sin responder')}</strong></div>
          {config.questions.map(([key, label]) => (
            <div className={stateClass(answers[key])} key={key}><span>{label.replace(/^¿|\?$/g, '')}</span><strong>{answers[key] || 'Sin responder'}</strong></div>
          ))}
        </div>
        {pick(device, ['Observacion']) && <div className="maintenance-inventory-observation"><Icon name="notes" /><p>{pick(device, ['Observacion'])}</p></div>}
        <div className="maintenance-inventory-evidence-heading">
          <div><strong>Evidencias</strong><span>{images.length} fotografía{images.length === 1 ? '' : 's'}</span></div>
          {pending && canEdit && <button className="button button--secondary button--compact" type="button" onClick={() => onAddEvidence(device)}><Icon name="add_a_photo" />Agregar</button>}
        </div>
        <div className="maintenance-inventory-images">
          {images.map((image) => (
            <figure key={pick(image, ['FotoDispositivoID', 'id'])}>
              <MaintenanceEvidenceImage image={image} sessionToken={sessionToken} alt={pick(image, ['Nombre'], 'Evidencia')} />
              <figcaption><strong>{pick(image, ['Tipo'], 'Evidencia')}</strong><span>{pick(image, ['Nota'], 'Sin nota')}</span></figcaption>
              {pending && canEdit && <button type="button" onClick={() => onEditEvidence(image, device)}><Icon name="edit" />Editar evidencia</button>}
            </figure>
          ))}
          {!images.length && <div className="maintenance-inventory-no-images"><Icon name="photo_library" /><span>Sin fotografías registradas.</span></div>}
        </div>
        {isOffline(device) && <div className="maintenance-inventory-offline-note"><Icon name="cloud_off" />Este dispositivo y sus evidencias están guardados en este equipo y se enviarán al recuperar conexión.</div>}
        <span className="maintenance-inventory-device-id">ID: {id}</span>
      </div>
    );
  }

  const drawerFields = (
    <>
      <FilterSelect label="Categoría" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="TODAS">Todas las categorías</option>
        {categories.map((name) => <option key={name} value={name}>{name}</option>)}
      </FilterSelect>
      <FilterSelect label="Estado" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
        <option value="TODOS">Todos los estados</option>
        <option value="CORRECTOS">Correctos</option>
        <option value="ATENCION">Requieren atención</option>
      </FilterSelect>
      <FilterSelect label="Dispositivos por página" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
        {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
      </FilterSelect>
    </>
  );

  return (
    <section className="maintenance-inventory-panel">
      <div className="maintenance-inventory-heading">
        <div><span className="eyebrow">INVENTARIO TÉCNICO</span><h2>Dispositivos del mantenimiento</h2><p>Vista compacta optimizada para trabajar con decenas o cientos de equipos.</p></div>
        {pending && canEdit && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar dispositivo</button>}
      </div>

      <div className="maintenance-device-toolbar maintenance-device-toolbar--detail">
        <label className="maintenance-device-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, zona, modelo, serie u observación..." /></label>
        <button type="button" className="icon-button icon-button--primary maintenance-inventory-filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Abrir filtros de dispositivos">
          <Icon name="tune" />
          {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
        <select className="maintenance-inventory-inline-filter" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoría"><option value="TODAS">Todas las categorías</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select className="maintenance-inventory-inline-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado"><option value="TODOS">Todos los estados</option><option value="CORRECTOS">Correctos</option><option value="ATENCION">Requieren atención</option></select>
        <select className="maintenance-inventory-inline-filter" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Filas por página">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}</select>
      </div>

      <div className="maintenance-device-category-chips">
        <button type="button" className={category === 'TODAS' ? 'is-active' : ''} onClick={() => setCategory('TODAS')}>Todos <span>{devices.length}</span></button>
        {categories.map((name) => <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name} <span>{devices.filter((item) => pick(item, ['Categoria'], 'Sin categoría') === name).length}</span></button>)}
      </div>

      {visible.length ? (
        <>
          <div className="maintenance-inventory-table-wrap">
            <table className="maintenance-inventory-table">
              <thead><tr><th>#</th><th>Nombre</th><th>Categoría</th><th>Ubicación</th><th>Modelo / Serie</th><th>Estado</th><th>Fotos</th><th>Acciones</th></tr></thead>
              <tbody>
                {visible.map((device, index) => {
                  const id = deviceId(device);
                  const open = expanded === id;
                  const images = device.Imagenes || [];
                  return (
                    <React.Fragment key={id}>
                      <tr className={open ? 'is-expanded' : ''}>
                        <td>{(page - 1) * pageSize + index + 1}</td>
                        <td><button type="button" className="maintenance-inventory-name" onClick={() => toggle(device)}><span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(pick(device, ['Categoria'])).icon} /></span><span><strong>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</strong>{isOffline(device) && <small><Icon name="cloud_off" />Offline</small>}</span></button></td>
                        <td>{pick(device, ['Categoria'], 'Sin categoría')}</td>
                        <td>{pick(device, ['Zona'], 'Sin ubicación')}</td>
                        <td>{[pick(device, ['Modelo']), pick(device, ['Serie'])].filter(Boolean).join(' · ') || 'Sin datos'}</td>
                        <td><span className={`maintenance-device-compact-state ${stateClass(pick(device, ['Estado']))}`}>{stateText(pick(device, ['Estado']))}</span></td>
                        <td><span className="maintenance-device-evidence-count"><Icon name="photo_library" />{images.length}</span></td>
                        <td>
                          <div className="maintenance-inventory-row-actions">
                            {pending && canEdit && <button type="button" className="icon-button" onClick={() => onEditDevice(device)} aria-label={`Editar ${pick(device, ['NombreDispositivo'], 'dispositivo')}`}><Icon name="edit" /></button>}
                            <button type="button" className="icon-button" onClick={() => toggle(device)} aria-expanded={open} aria-label={`Ver detalle de ${pick(device, ['NombreDispositivo'], 'dispositivo')}`}><Icon name={open ? 'expand_less' : 'expand_more'} /></button>
                          </div>
                        </td>
                      </tr>
                      {open && <tr className="maintenance-inventory-expanded-row"><td colSpan="8">{expandedContent(device)}</td></tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="maintenance-inventory-mobile-list">
            {visible.map((device, index) => {
              const id = deviceId(device);
              const open = expanded === id;
              return <article key={id} className={`maintenance-inventory-mobile-card${open ? ' is-expanded' : ''}`}>
                <button type="button" className="maintenance-inventory-mobile-toggle" onClick={() => toggle(device)} aria-expanded={open}>
                  <span className="maintenance-device-mobile-row__number">{(page - 1) * pageSize + index + 1}</span>
                  <span className="maintenance-device-list__icon"><Icon name={getMaintenanceCategory(pick(device, ['Categoria'])).icon} /></span>
                  <span><strong>{pick(device, ['NombreDispositivo'], 'Dispositivo')}</strong><small>{pick(device, ['Categoria'], 'Sin categoría')} · {pick(device, ['Zona'], 'Sin ubicación')}</small><span><em className={stateClass(pick(device, ['Estado']))}>{stateText(pick(device, ['Estado']))}</em><em><Icon name="photo_library" />{(device.Imagenes || []).length}</em>{isOffline(device) && <em className="is-offline"><Icon name="cloud_off" />Offline</em>}</span></span>
                  <Icon name={open ? 'expand_less' : 'expand_more'} />
                </button>
                {pending && canEdit && <button type="button" className="maintenance-inventory-mobile-edit" onClick={() => onEditDevice(device)}><Icon name="edit" />Editar dispositivo y evidencias</button>}
                {open && expandedContent(device)}
              </article>;
            })}
          </div>

          <nav className="maintenance-device-pagination" aria-label="Paginación de dispositivos">
            <span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} de {filtered.length}</span>
            <div><button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><Icon name="chevron_left" /></button><strong>{page} / {totalPages}</strong><button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}><Icon name="chevron_right" /></button></div>
          </nav>
        </>
      ) : (
        <div className="empty-state maintenance-device-empty"><Icon name="devices_other" /><h2>{devices.length ? 'No hay coincidencias' : 'Sin dispositivos registrados'}</h2><p>{devices.length ? 'Cambie los filtros para ver otros equipos.' : 'Este mantenimiento puede guardarse vacío. Agregue el primer equipo cuando esté listo.'}</p>{pending && canEdit && <button className="button button--primary" type="button" onClick={onAddDevice}><Icon name="add" />Agregar primer dispositivo</button>}</div>
      )}

      <FilterDrawer open={filterOpen} title="Filtros de dispositivos" onClose={() => setFilterOpen(false)} onApply={() => { setPage(1); setFilterOpen(false); }} onClear={clearFilters}>
        {drawerFields}
      </FilterDrawer>
    </section>
  );
}
