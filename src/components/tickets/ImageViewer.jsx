import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
  requestTicketProtectedSource,
  ticketMediaPreviewSource,
} from '../../services/ticketMediaSource';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function ImageViewer({
  boletaUid,
  items = [],
  initialIndex = 0,
  open,
  onClose,
}) {
  const { sessionToken } = useAuth();
  const closeRef = useRef(null);
  const requestVersionRef = useRef(0);
  const dragRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [source, setSource] = useState('');
  const [previewSource, setPreviewSource] = useState('');
  const [showingPreview, setShowingPreview] = useState(false);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const activeItem = items[activeIndex] || {};
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < items.length - 1;

  function resetZoom() {
    dragRef.current = null;
    setDragging(false);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }

  function zoomBy(delta) {
    setZoom((current) => {
      const next = clampZoom(current + delta);
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function toggleZoom() {
    setZoom((current) => {
      const next = current > MIN_ZOOM ? MIN_ZOOM : 2;
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  async function loadAt(index, force = false) {
    const item = items[index];
    if (!item) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const fallback = item.previewSource || ticketMediaPreviewSource(item) || '';

    setActiveIndex(index);
    setPreviewSource(fallback);
    setSource(fallback);
    setShowingPreview(Boolean(fallback));
    setLoadingOriginal(Boolean(item.evidenceId || item.fileId || item.kind === 'signature'));
    setLoadError(false);
    resetZoom();

    if (!(item.evidenceId || item.fileId || item.kind === 'signature')) {
      setLoadError(!fallback);
      setLoadingOriginal(false);
      return;
    }

    try {
      const original = item.fullSource || await requestTicketProtectedSource({
        boletaUid,
        evidenceId: item.evidenceId,
        fileId: item.fileId,
        kind: item.kind || 'evidence',
        sessionToken,
      }, {
        priority: 250,
        force,
      });
      if (requestVersionRef.current !== requestVersion) return;
      if (original) {
        setSource(original);
        setShowingPreview(false);
      } else {
        setLoadingOriginal(false);
        setLoadError(!fallback);
      }
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setSource(fallback);
      setShowingPreview(Boolean(fallback));
      setLoadingOriginal(false);
      setLoadError(!fallback);
    }
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
    if (!open || !items.length) return undefined;
    setActiveIndex(Math.min(Math.max(0, initialIndex), items.length - 1));
    loadAt(Math.min(Math.max(0, initialIndex), items.length - 1));

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      requestVersionRef.current += 1;
      document.body.style.overflow = previousOverflow;
    };
    // La carga se reinicia solo al abrir otra selección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIndex, items, boletaUid, sessionToken]);

  useEffect(() => {
    if (!open || !items.length) return undefined;

    [activeIndex - 1, activeIndex + 1].forEach((index) => {
      const neighbor = items[index];
      if (!neighbor || !(neighbor.evidenceId || neighbor.fileId || neighbor.kind === 'signature')) return;
      requestTicketProtectedSource({
        boletaUid,
        evidenceId: neighbor.evidenceId,
        fileId: neighbor.fileId,
        kind: neighbor.kind || 'evidence',
        sessionToken,
      }, { priority: 40 }).catch(() => {});
    });

    function handleKey(event) {
      if (event.key === 'Escape') onClose?.();
      else if (event.key === 'ArrowLeft' && canGoPrevious) loadAt(activeIndex - 1);
      else if (event.key === 'ArrowRight' && canGoNext) loadAt(activeIndex + 1);
      else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
      else if (event.key === '-') zoomBy(-ZOOM_STEP);
      else if (event.key === '0') resetZoom();
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  if (!open || !items.length) return null;

  return (
    <div className="image-viewer image-viewer--gallery" role="dialog" aria-modal="true" aria-label={activeItem.alt || 'Visor de imagen'}>
      <button ref={closeRef} className="image-viewer__close" type="button" onClick={onClose} aria-label="Cerrar visor"><Icon name="close" /></button>

      {items.length > 1 && (
        <>
          <button className="image-viewer__nav image-viewer__nav--previous" type="button" onClick={() => loadAt(activeIndex - 1)} disabled={!canGoPrevious} aria-label="Ver evidencia anterior"><Icon name="chevron_left" /></button>
          <button className="image-viewer__nav image-viewer__nav--next" type="button" onClick={() => loadAt(activeIndex + 1)} disabled={!canGoNext} aria-label="Ver evidencia siguiente"><Icon name="chevron_right" /></button>
          <div className="image-viewer__counter" aria-live="polite">{activeIndex + 1} / {items.length}</div>
        </>
      )}

      <div
        className={`image-viewer__canvas${zoom > MIN_ZOOM ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {source ? (
          <img
            src={source}
            alt={activeItem.alt || 'Evidencia'}
            referrerPolicy="no-referrer"
            draggable="false"
            onLoad={() => { if (!showingPreview) setLoadingOriginal(false); }}
            onError={() => {
              if (!showingPreview && previewSource) {
                setSource(previewSource);
                setShowingPreview(true);
                setLoadingOriginal(false);
                setLoadError(false);
              } else {
                setLoadingOriginal(false);
                setLoadError(true);
              }
            }}
            onDoubleClick={toggleZoom}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
          />
        ) : loadError ? (
          <div className="image-viewer__error">
            <Icon name="broken_image" />
            <strong>No se pudo cargar la imagen.</strong>
            <button type="button" onClick={() => loadAt(activeIndex, true)}>Reintentar</button>
          </div>
        ) : (
          <div className="image-viewer__loading"><Icon name="progress_activity" /> Cargando imagen…</div>
        )}
      </div>

      {loadingOriginal && source && (
        <div className="image-viewer__quality-loading" role="status">
          <Icon name="progress_activity" />
          <span>{showingPreview ? 'Mejorando calidad…' : 'Cargando imagen original…'}</span>
        </div>
      )}

      <div className="image-viewer__zoom-controls" aria-label="Controles de zoom">
        <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Alejar imagen"><Icon name="zoom_out" /></button>
        <button type="button" className="image-viewer__zoom-value" onClick={resetZoom} aria-label="Restablecer zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Acercar imagen"><Icon name="zoom_in" /></button>
        <button type="button" onClick={resetZoom} disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0} aria-label="Restablecer posición"><Icon name="restart_alt" /></button>
      </div>
    </div>
  );
}
