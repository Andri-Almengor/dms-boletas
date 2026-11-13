import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import ImageViewer from '../../components/tickets/ImageViewer';
import useOverlaySurface from '../../hooks/useOverlaySurface';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

const clean = (value) => String(value ?? '').trim();
const readableDate = (value) => {
  if (!value) return 'Sin fecha';
  const day = clean(value).slice(0,10);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(day);
  if (!iso) return clean(value).slice(0,25);
  const date = new Date(day + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica', day: '2-digit',month: 'short',year: 'numeric',
  }).format(date);
};
const sourcePath = (type, id) =>
  type === 'MANTENIMIENTO'
    ? '/mantenimientos/' + encodeURIComponent(id)
    : '/boletas/' + encodeURIComponent(id);
const sourceLabel = (type) => type === 'MANTENIMIENTO' ? 'Mantenimiento' : 'Boleta';

function InventoryDetailModal({ clientId, items, index, onMove, onClose, sessionToken, isAdmin, revision, onLinked }) {
  const item = items[index];
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [loadingMore, setLoadingMore] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeItems, setMergeItems] = useState([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeSaving, setMergeSaving] = useState(false);
  const pendingLinkRef = useRef(null);

  useOverlaySurface({ open: Boolean(item), onClose });
  useEffect(() => {
    if (!item?.id) return undefined;
    const controller = new AbortController();
    setData(null); setError(''); setLoading(true); setLightboxIndex(-1);
    setMergeOpen(false); setMergeQuery(''); setMergeItems([]); setMergeError('');
    pendingLinkRef.current = null;
    requestAvailable(MODULE_ROUTES.inventory.detail, { clientId, deviceId: item.id },
      sessionToken, { signal: controller.signal, cache: 'no-store' })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message || 'No se pudo cargar el dispositivo.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, item?.id, sessionToken]);

  useEffect(() => {
    if (!item || lightboxIndex >= 0) return undefined;
    const onKey = (event) => {
      if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); onMove(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onMove, lightboxIndex]);

  async function loadMore(kind) {
    if (!data || loadingMore) return;
    setLoadingMore(kind);
    setError('');
    try {
      const extra = await requestAvailable(MODULE_ROUTES.inventory.detail, {
        clientId, deviceId: item.id,
        includeEvents: kind === 'events',
        includeMedia: kind === 'media',
        eventOffset: kind === 'events' ? (data.events || []).length : 0,
        mediaOffset: kind === 'media' ? (data.media || []).length : 0,
      }, sessionToken, { cache: 'no-store' });
      if (kind === 'events') setData((current) => ({
        ...current, events: [...(current?.events || []), ...(extra.events || [])],
        hasMoreEvents: Boolean(extra.hasMoreEvents),
      }));
      else setData((current) => ({
        ...current, media: [...(current?.media || []), ...(extra.media || [])],
        hasMoreMedia: Boolean(extra.hasMoreMedia),
      }));
    } catch (cause) {
      setError(cause.message || 'No se pudo cargar más información.');
    } finally { setLoadingMore(''); }
  }

  useEffect(() => {
    if (!isAdmin || !mergeOpen || !item?.id) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMergeLoading(true);
      requestAvailable(MODULE_ROUTES.inventory.devices, {
        clienteId: clientId, page: 1, pageSize: 25, search: mergeQuery,
      }, sessionToken, { signal: controller.signal, cache: 'no-store' })
        .then((result) => {
          if (!controller.signal.aborted) setMergeItems(
            (result.items || []).filter((candidate) => candidate.id !== item.id));
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setMergeError(cause.message || 'No se pudieron buscar los equipos.');
        })
        .finally(() => { if (!controller.signal.aborted) setMergeLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [clientId, isAdmin, item?.id, mergeOpen, mergeQuery, sessionToken]);

  async function linkToDevice(other) {
    if (!isAdmin || mergeSaving || !item || other.id === item.id) return;
    const different = [
      ['Tipo', item.type, other.type],
      ['Fabricante', item.manufacturer, other.manufacturer],
      ['Modelo', item.model, other.model],
      ['Serie', item.serial, other.serial],
      ['MAC', item.mac, other.mac],
    ].filter(([, current, candidate]) => current && candidate
      && String(current).trim().toLowerCase() !== String(candidate).trim().toLowerCase());
    const caution = different.length
      ? '\n\nDiferencias registradas: ' + different.map(([label, a, b]) =>
        label + ' (' + a + ' / ' + b + ')').join('; ') + '. Verifique antes de confirmar.'
      : '';
    const message = '¿Confirmar que "' + other.name + '" y "' + item.name
      + '" son el mismo equipo?\n\nSe conservará "' + item.name
      + '" como nombre principal y se unirán las evidencias, fotografías y el historial. '
      + 'No se modificarán las boletas ni los mantenimientos originales.' + caution;
    if (!window.confirm(message)) return;
    const sameRequest = pendingLinkRef.current?.keepId === item.id
      && pendingLinkRef.current?.mergeId === other.id;
    const requestKey = sameRequest
      ? pendingLinkRef.current.key
      : (window.crypto?.randomUUID?.() || 'link-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    pendingLinkRef.current = { key: requestKey, keepId: item.id, mergeId: other.id };
    setMergeSaving(true);
    setMergeError('');
    try {
      await requestAvailable(MODULE_ROUTES.inventory.link, {
        clienteId: clientId, keepDeviceId: item.id, mergeDeviceId: other.id,
        expectedRevision: revision, requestKey,
      }, sessionToken, { cache: 'no-store' });
      pendingLinkRef.current = null;
      onLinked?.(item.name, other.name);
    } catch (cause) {
      setMergeError(cause.message || 'No se pudo vincular. Recargue el inventario y compruebe los dispositivos.');
    } finally { setMergeSaving(false); }
  }

  const sourceLoader = useCallback(async (photo) => {
    const route = photo.type === 'BOLETA'
      ? MODULE_ROUTES.tickets.mediaGet : MODULE_ROUTES.maintenance.mediaGet;
    const payload = photo.type === 'BOLETA'
      ? { boletaUid: photo.sourceId, evidenciaId: photo.evidenceId, EvidenciaID: photo.evidenceId,
        fileId: photo.fileId, kind: 'evidence' }
      : { imageId: photo.evidenceId, FotoDispositivoID: photo.evidenceId };
    const media = await requestAvailable(route, payload, sessionToken, { cache: 'no-store' });
    const url = media?.streamUrl || media?.dataUrl || media?.DataURL || media?.url;
    if (!url) throw new Error('No se pudo obtener la fotografía protegida.');
    return url;
  }, [sessionToken]);

  const current = data?.device || item;
  const photos = useMemo(() => (data?.media || []).map((photo) => ({
    ...photo,
    alt: photo.label + ' · ' + sourceLabel(photo.type),
    sourceLabel: sourceLabel(photo.type) + ': ' + (photo.label || ''),
    sourceDate: readableDate(photo.date),
    previewSource: photo.fileId
      ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(photo.fileId) + '&sz=w1200' : '',
  })), [data?.media]);
  if (!item) return null;

  return <>
    <div className="client-inventory-overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section className="client-inventory-detail" role="dialog" aria-modal="true"
        aria-label={'Detalle: ' + current.name}>
        <header className="client-inventory-detail__header">
          <div className="client-inventory-detail__identity">
            <span className="client-inventory-detail__symbol"><Icon name="devices" /></span>
            <div><span className="eyebrow">FICHA DEL DISPOSITIVO</span>
              <h2>{current.name}</h2>
              <div className="client-inventory-detail__meta">
                <span><Icon name="category" /> {current.type || 'Tipo sin especificar'}</span>
                <span><Icon name="location_on" /> {current.location || 'Sin ubicación'}</span>
              </div>
            </div>
          </div>
          <button type="button" className="icon-button client-inventory-detail__close" onClick={onClose} aria-label="Cerrar detalle"><Icon name="close" /></button>
        </header>
        <button type="button" className="client-inventory-detail__arrow client-inventory-detail__arrow--left"
          onClick={() => onMove(-1)} aria-label="Dispositivo anterior" title="Dispositivo anterior">
          <Icon name="chevron_left" />
        </button>
        <button type="button" className="client-inventory-detail__arrow client-inventory-detail__arrow--right"
          onClick={() => onMove(1)} aria-label="Dispositivo siguiente" title="Dispositivo siguiente">
          <Icon name="chevron_right" />
        </button>
        <div className="client-inventory-detail__body">
          {loading && <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando información...</div>}
          {error && <div className="alert alert--error" role="alert">{error}</div>}
          {!loading && !error && data && <>
            <section className="client-inventory-detail__section client-inventory-current-status" aria-label="Estado documentado del dispositivo">
              <div className="client-inventory-current-status__heading">
                <div><Icon name="monitor_heart" />
                  <h3>Estado actual según el último registro</h3></div>
                {current.details?.currentStatus && <span className={'client-inventory-condition client-inventory-condition--'
                  + (current.details.currentStatus.condition || 'NO_DETERMINADO').toLowerCase()}>
                  {current.details.currentStatus.condition === 'OPERATIVO' ? 'Operativo según registro'
                    : current.details.currentStatus.condition === 'REQUIERE_ATENCION' ? 'Requiere atención'
                      : 'Estado no confirmado'}
                </span>}
              </div>
              {current.details?.currentStatus ? <>
                <p>{current.details.currentStatus.summary || 'El registro no permite confirmar el estado del dispositivo.'}</p>
                <div className="client-inventory-current-status__footer">
                  <span><Icon name="event" /> {readableDate(current.details.currentStatus.date)}</span>
                  <span><Icon name="auto_awesome" /> {current.details.currentStatus.origin === 'gemini'
                    ? 'Resumen asistido por Gemini' : 'Resumen del registro disponible'}</span>
                  {current.details.currentStatus.sourceId && <Link
                    to={sourcePath(current.details.currentStatus.sourceType, current.details.currentStatus.sourceId)}
                    target="_blank" rel="noopener noreferrer">
                    Ver {current.details.currentStatus.sourceType === 'BOLETA' ? 'última boleta' : 'último mantenimiento'} <Icon name="open_in_new" />
                  </Link>}
                </div>
                <small>Estado basado en documentos del sistema; no es un diagnóstico ni una lectura del equipo en tiempo real.</small>
              </> : <p>El resumen estará disponible cuando un Administrador o Supervisor actualice el inventario.</p>}
            </section>
            <section className="client-inventory-detail__section">
              <h3><Icon name="tune" /> Características del equipo</h3>
              <dl className="client-inventory-features">
                {[
                  ['Tipo',current.type],['Fabricante',current.manufacturer],['Modelo',current.model],
                  ['Número de serie',current.serial],['Dirección MAC',current.mac],
                  ['Ubicación',current.location],['Funcionamiento',current.details?.functioning],
                  ['En uso',current.details?.inUse],['Estado',current.details?.state],
                ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Sin registrar'}</dd></div>)}
              </dl>
              {current.details?.aliases?.length > 1 && <p className="client-inventory-aliases">
                <Icon name="merge_type" /> <span><strong>Nombres consolidados:</strong> {current.details.aliases.join(' · ')}</span>
              </p>}
              {isAdmin && <div className="client-inventory-manual-link">
                <button type="button" className="button button--secondary"
                  aria-expanded={mergeOpen} onClick={() => { setMergeOpen((open) => !open); setMergeError(''); }}>
                  <Icon name="link" /> {mergeOpen ? 'Cancelar vinculación' : 'Vincular dispositivo duplicado'}
                </button>
                {mergeOpen && <div className="client-inventory-manual-link__panel">
                  <p>Busque otro registro de <strong>este cliente</strong> que corresponda al mismo equipo.
                    Se conservará <strong>{current.name}</strong> como ficha principal.</p>
                  <label className="field-group">
                    <span className="field-label">Buscar dispositivo para vincular</span>
                    <input type="search" className="form-control" value={mergeQuery}
                      onChange={(event) => { setMergeQuery(event.target.value); setMergeError(''); }}
                      placeholder="Nombre, ubicación, modelo o serie..." disabled={mergeSaving}
                      autoComplete="off" />
                  </label>
                  {mergeError && <div className="alert alert--error" role="alert">{mergeError}</div>}
                  {mergeLoading && <p className="field-hint">Buscando coincidencias…</p>}
                  {!mergeLoading && <div className="client-inventory-manual-link__results">
                    {mergeItems.length === 0 && <p className="field-hint">No se encontraron otros equipos.</p>}
                    {mergeItems.map((candidate) => <button type="button" key={candidate.id}
                      disabled={mergeSaving} onClick={() => linkToDevice(candidate)}>
                      <span><strong>{candidate.name}</strong>
                        <small>{candidate.type || 'Sin tipo'} · {candidate.location || 'Sin ubicación'}
                          {candidate.serial ? ' · Serie ' + candidate.serial : ''}</small></span>
                      <Icon name="link" />
                    </button>)}
                  </div>}
                  <small>Esta vinculación es manual, requiere confirmación y queda auditada.
                    No se permiten tipos, números de serie ni MAC incompatibles.
                    Los vínculos sobreviven a «Actualizar inventario».</small>
                </div>}
              </div>}
            </section>
            <section className="client-inventory-detail__section">
              <h3><Icon name="history" /> Historial de trabajos <span className="client-inventory-count">{data.events?.length || 0}{data.hasMoreEvents ? '+' : ''}</span></h3>
              {!(data.events || []).length
                ? <p className="field-hint">Todavía no hay trabajos relacionados de manera verificable con este dispositivo.</p>
                : <div className="client-inventory-timeline">{data.events.map((entry) => (
                  <article key={entry.id} className="client-inventory-timeline__event">
                    <div className="client-inventory-timeline__date"><Icon name="event" /> {readableDate(entry.date)}</div>
                    <div className="client-inventory-timeline__content">
                      <span className={'client-inventory-origin client-inventory-origin--' + entry.type.toLowerCase()}>{sourceLabel(entry.type)}</span>
                      <strong>{entry.title || sourceLabel(entry.type)}</strong>
                      <p>{entry.summary || 'Registro de trabajo sin observaciones adicionales.'}</p>
                      <p className="client-inventory-timeline__people"><Icon name="group" /> {entry.technicians || 'Técnicos sin registrar'}</p>
                      <Link to={sourcePath(entry.type, entry.sourceId)} target="_blank" rel="noopener noreferrer">
                        Ver {sourceLabel(entry.type).toLowerCase()} <Icon name="open_in_new" />
                      </Link>
                    </div>
                  </article>
                ))}</div>}
              {data.hasMoreEvents && <button type="button" className="button button--secondary"
                disabled={Boolean(loadingMore)} onClick={() => loadMore('events')}>
                {loadingMore === 'events' ? 'Cargando…' : 'Mostrar más trabajos'}
              </button>}
            </section>
            <section className="client-inventory-detail__section">
              <h3><Icon name="photo_library" /> Galería de evidencias <span className="client-inventory-count">{photos.length}{data.hasMoreMedia ? '+' : ''}</span></h3>
              {!photos.length
                ? <p className="field-hint">No hay fotografías asociadas a los trabajos registrados.</p>
                : <div className="client-inventory-gallery">
                  {photos.map((photo, i) => <button type="button" key={photo.id}
                    className="client-inventory-gallery__item" onClick={() => setLightboxIndex(i)}
                    aria-label={'Abrir fotografía de ' + photo.label + ', ' + readableDate(photo.date)}>
                    <span className="client-inventory-gallery__preview">
                      <Icon name="image" />
                      {photo.previewSource && <img src={photo.previewSource} loading="lazy" alt="" referrerPolicy="no-referrer"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                      <span className="client-inventory-gallery__zoom"><Icon name="zoom_in" /></span>
                    </span>
                    <span className="client-inventory-gallery__info">
                      <span className={'client-inventory-origin client-inventory-origin--' + photo.type.toLowerCase()}>{sourceLabel(photo.type)}</span>
                      <strong title={photo.label}>{photo.label}</strong>
                      <small><Icon name="event" /> {readableDate(photo.date)}</small>
                    </span>
                  </button>)}
                </div>}
              {data.hasMoreMedia && <button type="button" className="button button--secondary"
                disabled={Boolean(loadingMore)} onClick={() => loadMore('media')}>
                {loadingMore === 'media' ? 'Cargando…' : 'Mostrar más fotografías'}
              </button>}
            </section>
          </>}
        </div>
        <div className="client-inventory-detail__footer">
          <span><Icon name="inventory_2" /> Dispositivo <strong>{index+1}</strong> de {items.length} en esta página</span>
          <div><button type="button" className="button button--secondary" onClick={() => onMove(-1)}
            aria-label="Anterior"><Icon name="chevron_left" /> Anterior</button>
          <button type="button" className="button button--secondary" onClick={() => onMove(1)}
            aria-label="Siguiente">Siguiente <Icon name="chevron_right" /></button></div>
        </div>
      </section>
    </div>
    <ImageViewer open={lightboxIndex >= 0} items={photos} initialIndex={Math.max(0,lightboxIndex)}
      onClose={() => setLightboxIndex(-1)} sourceLoader={sourceLoader} />
  </>;
}

function ClientList({ sessionToken, isAdmin, navigate }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    requestAvailable(MODULE_ROUTES.inventory.clients, { search: debouncedSearch, page, pageSize: 25 },
      sessionToken, { signal: controller.signal, cache: 'no-store' })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message || 'No se pudo consultar el inventario.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [debouncedSearch, page, reload, sessionToken]);

  async function generate(item) {
    if (!isAdmin || working) return;
    if (!window.confirm((item.generatedAt ? '¿Actualizar' : '¿Generar') + ' el inventario de '
      + item.name + '? Se consultarán sus mantenimientos y boletas actuales.')) return;
    setWorking(item.id); setError('');
    try {
      await requestAvailable(MODULE_ROUTES.inventory.generate, { clienteId: item.id }, sessionToken);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message || 'No se pudo generar el inventario.');
    } finally { setWorking(''); }
  }

  return <div className="client-inventory-page">
    <header className="client-inventory-page__header">
      <div><span className="eyebrow">DMS BOLETAS · GESTIÓN DE EQUIPOS</span><h1>Inventario</h1>
        <p>Clientes con mantenimientos registrados. El inventario se genera o actualiza únicamente cuando lo solicitás.</p></div>
    </header>
    <label className="field-group client-inventory-search"><span className="field-label">Buscar cliente</span>
      <span className="client-inventory-search__input"><Icon name="search" />
        <input className="form-control" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Nombre del cliente con mantenimiento..." /></span></label>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {loading && <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando clientes...</div>}
    {!loading && !result.items.length && <div className="empty-state"><Icon name="groups" />
      <p>No hay clientes con mantenimientos registrados para esta búsqueda.</p></div>}
    {!loading && <div className="client-inventory-clients">
      {result.items.map((item) => <article className="client-inventory-client" key={item.id}>
        <div className="client-inventory-client__top">
          <span className="client-inventory-client__icon"><Icon name="business" /></span>
          <span className={'client-inventory-client__status' + (item.generatedAt ? ' is-ready' : '')}>
            <Icon name={item.generatedAt ? 'check_circle' : 'schedule'} />
            {item.generatedAt ? 'Disponible' : 'Sin generar'}
          </span>
        </div>
        <div className="client-inventory-client__main">
          <h2>{item.name}</h2>
          <p>{item.generatedAt
            ? <><strong>{item.deviceCount} dispositivos</strong> · Actualizado el {readableDate(item.generatedAt)}</>
            : 'Mantenimiento registrado · Inventario pendiente de generar'}</p>
          {item.aiStatus === 'gemini_no_disponible' && <small className="client-inventory-warning">
            Gemini no estuvo disponible; solo se unificaron coincidencias verificables.</small>}
        </div>
        <div className="client-inventory-client__actions">
          {item.generatedAt && <Link className="button button--secondary"
            target="_blank" rel="noopener noreferrer" to={'/inventario/' + encodeURIComponent(item.id)}>
            <Icon name="open_in_new" /> Ver inventario
          </Link>}
          {isAdmin && <button type="button" className="button button--primary"
            disabled={Boolean(working)} onClick={() => generate(item)}>
            <Icon name={item.generatedAt ? 'refresh' : 'inventory_2'} />
            {working === item.id ? 'Procesando…' : item.generatedAt ? 'Actualizar inventario' : 'Generar inventario'}
          </button>}
        </div>
      </article>)}
    </div>}
    <footer className="client-inventory-pagination">
      <button className="button button--secondary" type="button" disabled={loading || page===1}
        onClick={() => setPage((n)=>Math.max(1,n-1))}>Anterior</button>
      <span>Página {page}</span>
      <button className="button button--secondary" type="button" disabled={loading || !result.hasMore}
        onClick={() => setPage((n)=>n+1)}>Siguiente</button>
    </footer>
  </div>;
}

function InventoryClientTable({ clientId, sessionToken, navigate, isAdmin }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState(-1);
  const [version, setVersion] = useState(0);
  const pendingArrowRef = useRef('');

  useEffect(() => {
    const timer=setTimeout(()=>{pendingArrowRef.current='';setDebouncedSearch(search);setPage(1);setSelected(-1);},250);
    return ()=>clearTimeout(timer);
  },[search]);
  useEffect(() => {
    const controller=new AbortController();
    setLoading(true);setError('');
    requestAvailable(MODULE_ROUTES.inventory.devices,
      { clienteId: clientId, page, pageSize: 50, search: debouncedSearch },
      sessionToken, { signal: controller.signal, cache: 'no-store' })
      .then((data)=>{
        if (controller.signal.aborted) return;
        setResult(data);
        if (pendingArrowRef.current && data?.items?.length) {
          setSelected(pendingArrowRef.current === 'last' ? data.items.length - 1 : 0);
          pendingArrowRef.current='';
        }
      })
      .catch((cause)=>{if(!controller.signal.aborted)setError(cause.message||'No se pudo cargar el inventario.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[clientId,page,debouncedSearch,sessionToken,version]);

  const moveDevice=useCallback((delta)=>{
    if (selected < 0) return;
    const next = selected + delta;
    if (next >= 0 && next < result.items.length) { setSelected(next); return; }
    if (next >= result.items.length && result.hasMore) {
      pendingArrowRef.current = 'first';
      setSelected(-1);
      setPage((current) => current + 1);
    } else if (next < 0 && page > 1) {
      pendingArrowRef.current = 'last';
      setSelected(-1);
      setPage((current) => current - 1);
    }
  },[selected,page,result.items.length,result.hasMore]);

  const totalPages = Math.max(1, Math.ceil(Number(result.totalFiltered ?? result.total ?? 0) / 50));
  const goToPage = (delta) => {
    if (loading) return;
    setSelected(-1);
    pendingArrowRef.current = '';
    setPage((current) => Math.min(totalPages, Math.max(1, current + delta)));
  };

  return <div className="client-inventory-page client-inventory-page--table">
    <header className="client-inventory-page__header">
      <div><button type="button" className="button button--secondary" onClick={()=>navigate('/inventario')}>
        <Icon name="arrow_back" /> Volver a clientes</button>
        <span className="eyebrow">INVENTARIO DEL CLIENTE</span><h1>Dispositivos</h1>
        <p>Equipos consolidados desde mantenimientos, con historial de boletas relacionadas.</p></div>
      <button type="button" className="button button--secondary" onClick={()=>setVersion((v)=>v+1)}>
        <Icon name="refresh" /> Recargar vista</button>
    </header>
    {result.generated && <div className="client-inventory-summary">
      <span className="client-inventory-summary__icon"><Icon name="inventory_2" /></span>
      <div><strong>{result.total} dispositivos</strong><small>Inventario consolidado</small></div>
      <span className="client-inventory-summary__date"><Icon name="update" /> Actualizado: {readableDate(result.generatedAt)}</span>
    </div>}
    <div className="client-inventory-table-tools">
      <label className="field-group client-inventory-search"><span className="field-label">Buscar dispositivo</span>
      <span className="client-inventory-search__input"><Icon name="search" />
        <input className="form-control" type="search" value={search} onChange={(e)=>setSearch(e.target.value)}
          placeholder="Nombre, ubicación, fabricante, modelo, serie..." /></span></label>
      {result.generated && <nav className="client-inventory-top-pager" aria-label="Páginas del inventario">
        <button type="button" onClick={() => goToPage(-1)} disabled={loading || page <= 1}
          aria-label="Página anterior"><Icon name="chevron_left" /></button>
        <span aria-live="polite" aria-label={'Página ' + page + ' de ' + totalPages}>
          <strong>{page}</strong><span>/</span>{totalPages}
        </span>
        <button type="button" onClick={() => goToPage(1)} disabled={loading || page >= totalPages}
          aria-label="Página siguiente"><Icon name="chevron_right" /></button>
      </nav>}
    </div>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {success && <div className="alert alert--success" role="status"><Icon name="check_circle" /> {success}</div>}
    {loading && <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando equipos...</div>}
    {!loading && !result.generated && <div className="empty-state">
      <Icon name="inventory_2" /><p>Este cliente aún no tiene inventario generado por un Administrador o Supervisor.</p></div>}
    {!loading && result.generated && !result.items.length && <div className="empty-state">
      <Icon name="search_off" /><p>No hay equipos registrados en mantenimientos para esta búsqueda.</p></div>}
    {!loading && result.items.length>0 && <div className="client-inventory-table-wrap">
      <table className="client-inventory-table">
        <thead><tr><th>Nombre del dispositivo</th><th>Tipo</th><th>Ubicación</th>
          <th>Fabricante</th><th>Modelo</th><th>Serie</th><th>Detalle</th></tr></thead>
        <tbody>{result.items.map((item,index)=><tr key={item.id}>
          <td className="client-inventory-table__name"><span className="client-inventory-table__name-wrap">
            <span className="client-inventory-table__device-icon"><Icon name="devices" /></span>
            <strong>{item.name}</strong>
          </span></td>
          <td className="client-inventory-table__extra"><span className="client-inventory-type">{item.type||'—'}</span></td>
          <td className="client-inventory-table__extra">{item.location||'—'}</td>
          <td className="client-inventory-table__extra">{item.manufacturer||'—'}</td>
          <td className="client-inventory-table__extra">{item.model||'—'}</td>
          <td className="client-inventory-table__extra">{item.serial||'—'}</td>
          <td><button type="button" className="button button--secondary client-inventory-table__open"
            onClick={()=>setSelected(index)} aria-label={'Ver detalle de '+item.name}>
              <Icon name="visibility" /><span>Ver</span></button></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {selected>=0 && <InventoryDetailModal clientId={clientId} items={result.items} index={selected}
      sessionToken={sessionToken} isAdmin={isAdmin} revision={result.revision}
      onLinked={(keptName, duplicateName) => {
        setSelected(-1);
        setSuccess('Se vinculó "' + duplicateName + '" con "' + keptName + '". Se conservaron sus historiales y fotografías.');
        setVersion((value) => value + 1);
      }}
      onClose={()=>setSelected(-1)} onMove={moveDevice}/>}
  </div>;
}

export default function ClientInventoryPage() {
  const { clienteId }=useParams();
  const { sessionToken,hasPermission }=useAuth();
  const navigate=useNavigate();
  const isAdmin=hasPermission('USUARIOS_GESTIONAR');
  return clienteId
    ? <InventoryClientTable clientId={clienteId} sessionToken={sessionToken} navigate={navigate} isAdmin={isAdmin}/>
    : <ClientList sessionToken={sessionToken} isAdmin={isAdmin} navigate={navigate}/>;
}
