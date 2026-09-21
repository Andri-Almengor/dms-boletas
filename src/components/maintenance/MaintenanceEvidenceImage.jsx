import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { evidenceMediaKind } from '../../utils/evidenceMedia';

const protectedMediaCache = new Map();
const protectedMediaRequests = new Map();
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

async function requestProtectedSource(imageId, sessionToken, force = false) {
  if (!force && protectedMediaCache.has(imageId)) return protectedMediaCache.get(imageId);
  if (!force && protectedMediaRequests.has(imageId)) return protectedMediaRequests.get(imageId);

  const task = requestAvailable(
    MODULE_ROUTES.maintenance.mediaGet,
    { imageId, FotoDispositivoID: imageId },
    sessionToken,
  ).then((media) => {
    const source = pick(media, ['streamUrl', 'dataUrl', 'DataURL', 'url']);
    if (!source) throw new Error('La evidencia no devolvió contenido.');
    protectedMediaCache.set(imageId, source);
    return source;
  }).finally(() => {
    protectedMediaRequests.delete(imageId);
  });

  protectedMediaRequests.set(imageId, task);
  return task;
}

function evidenceKind(image, alt = 'Evidencia') {
  const mediaType = String(pick(image, ['TipoMedio', 'mediaType'], '')).toLowerCase();
  if (mediaType === 'video') return 'video';
  return evidenceMediaKind({
    mimeType: pick(image, ['MimeType']),
    name: pick(image, ['Nombre', 'NombreArchivo'], alt),
  });
}

function evidenceId(image) {
  return String(pick(image, ['FotoDispositivoID', 'id'], ''));
}

function evidenceSource(image) {
  return pick(image, ['PreviewURL', 'previewUrl', 'DriveURL', 'url']);
}

function evidenceKey(image, index = 0) {
  return evidenceId(image) || evidenceSource(image) || `evidence-${index}`;
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function MaintenanceEvidenceImage({
  image,
  galleryImages,
  sessionToken,
  alt = 'Evidencia',
}) {
  const imageId = evidenceId(image);
  const initialSource = evidenceSource(image);
  const kind = evidenceKind(image, alt);
  const attemptedRef = useRef(false);
  const fullImageRequestRef = useRef(0);
  const dragRef = useRef(null);
  const [source, setSource] = useState(kind === 'video' ? '' : initialSource);
  const [fullSource, setFullSource] = useState('');
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [loadingFullSource, setLoadingFullSource] = useState(false);
  const [showingPreview, setShowingPreview] = useState(false);
  const [fullError, setFullError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const gallery = useMemo(() => {
    const candidates = Array.isArray(galleryImages) && galleryImages.length ? galleryImages : [image];
    return candidates.filter((item) => evidenceKind(item, alt) !== 'video');
  }, [galleryImages, image, alt]);

  const ownGalleryIndex = useMemo(() => {
    const key = evidenceKey(image);
    const found = gallery.findIndex((item, index) => evidenceKey(item, index) === key);
    return found >= 0 ? found : 0;
  }, [gallery, image]);

  const activeImage = gallery[activeIndex] || image;
  const activeAlt = pick(activeImage, ['Nombre', 'NombreArchivo'], alt);
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < gallery.length - 1;

  async function loadProtectedMedia(force = false) {
    if (!imageId || (!force && attemptedRef.current)) {
      if (!imageId) setFailed(true);
      return;
    }

    attemptedRef.current = true;
    setLoadingFallback(true);
    setFailed(false);
    try {
      const protectedSource = await requestProtectedSource(imageId, sessionToken, force);
      setSource(protectedSource);
      setFailed(false);
    } catch {
      setFailed(true);
      setSource('');
    } finally {
      setLoadingFallback(false);
    }
  }

  function resetZoom() {
    dragRef.current = null;
    setDragging(false);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }

  function changeZoom(nextZoom) {
    const next = clampZoom(nextZoom);
    setZoom(next);
    if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
  }

  function zoomBy(delta) {
    setZoom((current) => {
      const next = clampZoom(current + delta);
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  async function loadFullImageAt(index, force = false) {
    const nextImage = gallery[index] || image;
    if (!nextImage) return;

    const nextId = evidenceId(nextImage);
    const fallback = evidenceSource(nextImage);
    const requestVersion = fullImageRequestRef.current + 1;
    fullImageRequestRef.current = requestVersion;

    setActiveIndex(index);
    setFullSource(fallback || '');
    setShowingPreview(Boolean(fallback && nextId));
    setFullError(false);
    setLoadingFullSource(Boolean(nextId));
    resetZoom();

    if (!nextId) {
      setFullError(!fallback);
      setLoadingFullSource(false);
      setShowingPreview(false);
      return;
    }

    try {
      const protectedSource = await requestProtectedSource(nextId, sessionToken, force);
      if (fullImageRequestRef.current === requestVersion) {
        const nextSource = protectedSource || fallback || '';
        setFullSource(nextSource);
        setShowingPreview(Boolean(fallback && !protectedSource));
        setFullError(!nextSource);
        if (!protectedSource) setLoadingFullSource(false);
      }
    } catch {
      if (fullImageRequestRef.current === requestVersion) {
        setFullSource(fallback || '');
        setShowingPreview(Boolean(fallback));
        setFullError(!fallback);
        setLoadingFullSource(false);
      }
    }
  }

  function warmCurrentFullImage() {
    const target = gallery[ownGalleryIndex] || image;
    const targetId = evidenceId(target);
    if (!targetId) return;
    requestProtectedSource(targetId, sessionToken).catch(() => {});
  }

  function openFullImage() {
    if (!source && !imageId) return;
    setOpen(true);
    loadFullImageAt(ownGalleryIndex);
  }

  function closeFullImage() {
    fullImageRequestRef.current += 1;
    setOpen(false);
    setFullSource('');
    setShowingPreview(false);
    setFullError(false);
    setLoadingFullSource(false);
    resetZoom();
  }

  function showPrevious() {
    if (canGoPrevious) loadFullImageAt(activeIndex - 1);
  }

  function showNext() {
    if (canGoNext) loadFullImageAt(activeIndex + 1);
  }

  function toggleZoom() {
    changeZoom(zoom > MIN_ZOOM ? MIN_ZOOM : 2);
  }

  function beginPan(event) {
    if (zoom <= MIN_ZOOM || event.pointerType === 'touch') return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }

  function movePan(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || zoom <= MIN_ZOOM) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
  }

  function endPan(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  }

  useEffect(() => {
    fullImageRequestRef.current += 1;
    attemptedRef.current = false;
    setFailed(false);
    setOpen(false);
    setFullSource('');
    setShowingPreview(false);
    setFullError(false);
    setLoadingFullSource(false);
    setSource(kind === 'video' ? '' : initialSource);
    resetZoom();
    if (imageId && (kind === 'video' || !initialSource)) loadProtectedMedia();
    // Solo debe ejecutarse al cambiar de evidencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, initialSource, sessionToken, kind]);

  useEffect(() => {
    if (!open) return undefined;

    [activeIndex - 1, activeIndex + 1].forEach((index) => {
      const neighbor = gallery[index];
      const neighborId = neighbor && evidenceId(neighbor);
      if (neighborId) requestProtectedSource(neighborId, sessionToken).catch(() => {});
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeFullImage();
      else if (event.key === 'ArrowLeft') showPrevious();
      else if (event.key === 'ArrowRight') showNext();
      else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
      else if (event.key === '-') zoomBy(-ZOOM_STEP);
      else if (event.key === '0') resetZoom();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  if (failed && !source) {
    return (
      <div className="maintenance-evidence-image maintenance-evidence-image--error">
        <Icon name={kind === 'video' ? 'videocam_off' : 'broken_image'} />
        <span>No se pudo cargar</span>
        <button type="button" onClick={() => { attemptedRef.current = false; setFailed(false); loadProtectedMedia(true); }}>
          Reintentar
        </button>
      </div>
    );
  }

  if (kind === 'video') {
    return source
      ? <div className="maintenance-evidence-video"><video src={source} controls preload="metadata" playsInline aria-label={alt} /></div>
      : <div className="maintenance-evidence-image"><span className="maintenance-evidence-image__loading"><Icon name="progress_activity" /> {loadingFallback ? 'Cargando video...' : 'Preparando video...'}</span></div>;
  }

  return (
    <>
      <button
        type="button"
        className="maintenance-evidence-image"
        onClick={openFullImage}
        onPointerEnter={warmCurrentFullImage}
        onFocus={warmCurrentFullImage}
        onTouchStart={warmCurrentFullImage}
        aria-label="Abrir evidencia en tamaño completo"
      >
        {source ? (
          <img
            src={source}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (imageId && !attemptedRef.current) loadProtectedMedia();
              else {
                setSource('');
                setFailed(true);
              }
            }}
          />
        ) : (
          <span className="maintenance-evidence-image__loading"><Icon name="progress_activity" /> {loadingFallback ? 'Cargando...' : 'Preparando imagen...'}</span>
        )}
        <span className="maintenance-evidence-image__zoom"><Icon name="zoom_in" /></span>
      </button>

      {open && (
        <div className="maintenance-lightbox maintenance-lightbox--gallery" role="dialog" aria-modal="true" aria-label="Vista completa de evidencia">
          <button className="maintenance-lightbox__close" type="button" onClick={closeFullImage} aria-label="Cerrar imagen"><Icon name="close" /></button>

          {gallery.length > 1 && (
            <>
              <button className="maintenance-lightbox__nav maintenance-lightbox__nav--previous" type="button" onClick={showPrevious} disabled={!canGoPrevious} aria-label="Ver evidencia anterior">
                <Icon name="chevron_left" />
              </button>
              <button className="maintenance-lightbox__nav maintenance-lightbox__nav--next" type="button" onClick={showNext} disabled={!canGoNext} aria-label="Ver evidencia siguiente">
                <Icon name="chevron_right" />
              </button>
              <div className="maintenance-lightbox__counter" aria-live="polite">{activeIndex + 1} / {gallery.length}</div>
            </>
          )}

          <div
            className={`maintenance-lightbox__stage${zoom > MIN_ZOOM ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            {fullSource ? (
              <img
                className="maintenance-lightbox__image"
                src={fullSource}
                alt={activeAlt}
                referrerPolicy="no-referrer"
                draggable="false"
                onLoad={() => { if (!showingPreview) setLoadingFullSource(false); }}
                onDoubleClick={toggleZoom}
                style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
              />
            ) : fullError ? (
              <div className="maintenance-lightbox__error">
                <Icon name="broken_image" />
                <strong>No se pudo cargar la imagen.</strong>
                <button type="button" onClick={() => loadFullImageAt(activeIndex, true)}>Reintentar</button>
              </div>
            ) : (
              <span className="maintenance-lightbox__loading"><Icon name="progress_activity" /> {loadingFullSource ? 'Cargando imagen original...' : 'Preparando imagen original...'}</span>
            )}
          </div>

          {loadingFullSource && fullSource && (
            <div className="maintenance-lightbox__quality-loading" role="status">
              <Icon name="progress_activity" />
              <span>{showingPreview ? 'Mejorando calidad…' : 'Cargando imagen original…'}</span>
            </div>
          )}

          <div className="maintenance-lightbox__zoom-controls" aria-label="Controles de zoom">
            <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Alejar"><Icon name="zoom_out" /></button>
            <button type="button" className="maintenance-lightbox__zoom-value" onClick={resetZoom} aria-label="Restablecer zoom">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Acercar"><Icon name="zoom_in" /></button>
            <button type="button" onClick={resetZoom} disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0} aria-label="Restablecer posición"><Icon name="restart_alt" /></button>
          </div>
        </div>
      )}
    </>
  );
}
