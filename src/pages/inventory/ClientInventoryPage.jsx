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

function InventoryDetailModal({ clientId, items, index, onMove, onClose, sessionToken }) {
  const item = items[index];
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [loadingMore, setLoadingMore] = useState('');

  useOverlaySurface({ open: Boolean(item), onClose });
  useEffect(() => {
    if (!item?.id) return undefined;
    const controller = new AbortController();
    setData(null); setError(''); setLoading(true); setLightboxIndex(-1);
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

  if (!item) return null;
  const current = data?.device || item;
  const photos = useMemo(() => (data?.media || []).map((photo) => ({
    ...photo,
    alt: photo.label + ' · ' + sourceLabel(photo.type),
    sourceLabel: sourceLabel(photo.type) + ': ' + (photo.label || ''),
    sourceDate: readableDate(photo.date),
    previewSource: photo.fileId
      ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(photo.fileId) + '&sz=w1200' : '',
  })), [data?.media]);

  return <>
    <div className="client-inventory-overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section className="client-inventory-detail" role="dialog" aria-modal="true"
        aria-label={'Detalle: ' + current.name}>
        <header className="client-inventory-detail__header">
          <div><span className="eyebrow">INVENTARIO · DISPOSITIVO</span>
            <h2>{current.name}</h2>
            <small>{current.type || 'Tipo sin especificar'} · {current.location || 'Sin ubicación'}</small>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar detalle"><Icon name="close" /></button>
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
            <section className="client-inventory-detail__section">
              <h3>Características del equipo</h3>
              <dl className="client-inventory-features">
                {[
                  ['Tipo',current.type],['Fabricante',current.manufacturer],['Modelo',current.model],
                  ['Número de serie',current.serial],['Dirección MAC',current.mac],
                  ['Ubicación',current.location],['Funcionamiento',current.details?.functioning],
                  ['En uso',current.details?.inUse],['Estado',current.details?.state],
                ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Sin registrar'}</dd></div>)}
              </dl>
              {current.details?.aliases?.length > 1 && <p className="field-hint">
                Nombres consolidados: {current.details.aliases.join(' · ')}
              </p>}
            </section>
            <section className="client-inventory-detail__section">
              <h3>Historial de trabajos <span>({data.events?.length || 0})</span></h3>
              {!(data.events || []).length
                ? <p className="field-hint">Todavía no hay trabajos relacionados de manera verificable con este dispositivo.</p>
                : <div className="client-inventory-timeline">{data.events.map((entry) => (
                  <article key={entry.id} className="client-inventory-timeline__event">
                    <div className="client-inventory-timeline__date">{readableDate(entry.date)}</div>
                    <div><strong>{entry.title || sourceLabel(entry.type)}</strong>
                      <small>{sourceLabel(entry.type)}</small>
                      <p>{entry.summary || 'Registro de trabajo sin observaciones adicionales.'}</p>
                      <p className="client-inventory-timeline__people"><Icon name="engineering" /> {entry.technicians || 'Técnicos sin registrar'}</p>
                      <Link to={sourcePath(entry.type, entry.sourceId)} target="_blank" rel="noopener noreferrer">
                        <Icon name="open_in_new" /> Ver {sourceLabel(entry.type).toLowerCase()}
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
              <h3>Galería de evidencias <span>({photos.length})</span></h3>
              {!photos.length
                ? <p className="field-hint">No hay fotografías asociadas a los trabajos registrados.</p>
                : <div className="client-inventory-gallery">
                  {photos.map((photo, i) => <button type="button" key={photo.id}
                    className="client-inventory-gallery__item" onClick={() => setLightboxIndex(i)}
                    aria-label={'Abrir fotografía de ' + photo.label}>
                    {photo.previewSource
                      ? <img src={photo.previewSource} loading="lazy" alt="" referrerPolicy="no-referrer"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      : <Icon name="image" />}
                    <strong>{photo.label}</strong>
                    <small>{sourceLabel(photo.type)} · {readableDate(photo.date)}</small>
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
          <span>Dispositivo {index+1} de {items.length} en esta página</span>
          <div><button type="button" className="button button--secondary" onClick={() => onMove(-1)}
            aria-label="Anterior">Anterior</button>
          <button type="button" className="button button--secondary" onClick={() => onMove(1)}
            aria-label="Siguiente">Siguiente</button></div>
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
      <div><span className="eyebrow">DMS BOLETAS</span><h1>Inventario</h1>
        <p>Clientes con boletas o mantenimientos registrados. El inventario se genera solamente al solicitarlo.</p></div>
    </header>
    <label className="field-group client-inventory-search"><span className="field-label">Buscar cliente</span>
      <input className="form-control" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Nombre del cliente..." /></label>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {loading && <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando clientes...</div>}
    {!loading && !result.items.length && <div className="empty-state"><Icon name="groups" />
      <p>No hay clientes con actividad registrada para esta búsqueda.</p></div>}
    {!loading && <div className="client-inventory-clients">
      {result.items.map((item) => <article className="client-inventory-client" key={item.id}>
        <div><h2>{item.name}</h2>
          <p>{item.generatedAt
            ? 'Inventario generado · ' + readableDate(item.generatedAt) + ' · ' + item.deviceCount + ' dispositivos'
            : 'Todavía no se ha generado un inventario'}</p>
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

function InventoryClientTable({ clientId, sessionToken, navigate }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  return <div className="client-inventory-page client-inventory-page--table">
    <header className="client-inventory-page__header">
      <div><button type="button" className="button button--secondary" onClick={()=>navigate('/inventario')}>
        <Icon name="arrow_back" /> Volver a clientes</button>
        <span className="eyebrow">INVENTARIO DEL CLIENTE</span><h1>Dispositivos</h1>
        <p>Registro consolidado desde mantenimientos y boletas relacionadas.</p></div>
      <button type="button" className="button button--secondary" onClick={()=>setVersion((v)=>v+1)}>
        <Icon name="refresh" /> Recargar vista</button>
    </header>
    {result.generated && <p className="field-hint">Total: {result.total} dispositivos · Última generación: {readableDate(result.generatedAt)}</p>}
    <label className="field-group client-inventory-search"><span className="field-label">Buscar dispositivo</span>
      <input className="form-control" type="search" value={search} onChange={(e)=>setSearch(e.target.value)}
        placeholder="Nombre, ubicación, modelo, serie..." /></label>
    {error && <div className="alert alert--error" role="alert">{error}</div>}
    {loading && <div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando equipos...</div>}
    {!loading && !result.generated && <div className="empty-state">
      <Icon name="inventory_2" /><p>Este cliente aún no tiene inventario generado por un administrador.</p></div>}
    {!loading && result.generated && !result.items.length && <div className="empty-state">
      <Icon name="search_off" /><p>No hay equipos registrados en mantenimientos para esta búsqueda.</p></div>}
    {!loading && result.items.length>0 && <div className="client-inventory-table-wrap">
      <table className="client-inventory-table">
        <thead><tr><th>Nombre del dispositivo</th><th>Tipo</th><th>Ubicación</th>
          <th>Fabricante</th><th>Modelo</th><th>Serie</th><th>Detalle</th></tr></thead>
        <tbody>{result.items.map((item,index)=><tr key={item.id}>
          <td className="client-inventory-table__name">{item.name}</td>
          <td className="client-inventory-table__extra">{item.type||'—'}</td>
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
    <footer className="client-inventory-pagination">
      <button type="button" className="button button--secondary" onClick={()=>{setPage(n=>Math.max(1,n-1));setSelected(-1);}}
        disabled={loading||page===1}>Anterior</button>
      <span>Página {page}</span>
      <button type="button" className="button button--secondary" disabled={loading||!result.hasMore}
        onClick={()=>{setPage(n=>n+1);setSelected(-1);}}>Siguiente</button>
    </footer>
    {selected>=0 && <InventoryDetailModal clientId={clientId} items={result.items} index={selected}
      sessionToken={sessionToken} onClose={()=>setSelected(-1)} onMove={moveDevice}/>}
  </div>;
}

export default function ClientInventoryPage() {
  const { clienteId }=useParams();
  const { sessionToken,hasPermission }=useAuth();
  const navigate=useNavigate();
  const isAdmin=hasPermission('USUARIOS_GESTIONAR');
  return clienteId
    ? <InventoryClientTable clientId={clienteId} sessionToken={sessionToken} navigate={navigate}/>
    : <ClientList sessionToken={sessionToken} isAdmin={isAdmin} navigate={navigate}/>;
}
