import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import { evidenceMediaKind } from '../../utils/evidenceMedia';

const protectedMediaCache = new Map();
const protectedMediaRequests = new Map();

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

export default function MaintenanceEvidenceImage({ image, sessionToken, alt = 'Evidencia' }) {
  const imageId = String(pick(image, ['FotoDispositivoID', 'id']));
  const initialSource = pick(image, ['PreviewURL', 'previewUrl', 'DriveURL', 'url']);
  const mediaType = String(pick(image, ['TipoMedio', 'mediaType'], '')).toLowerCase();
  const kind = mediaType === 'video' || mediaType === 'video'.toUpperCase()
    ? 'video'
    : evidenceMediaKind({ mimeType: pick(image, ['MimeType']), name: pick(image, ['Nombre', 'NombreArchivo'], alt) });
  const attemptedRef = useRef(false);
  const fullImageRequestRef = useRef(0);
  const [source, setSource] = useState(kind === 'video' ? '' : initialSource);
  const [fullSource, setFullSource] = useState('');
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [loadingFullSource, setLoadingFullSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

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

  async function openFullImage() {
    if (!source && !imageId) return;

    setOpen(true);
    setFullSource('');

    if (!imageId) {
      setFullSource(source);
      return;
    }

    const requestVersion = fullImageRequestRef.current + 1;
    fullImageRequestRef.current = requestVersion;
    setLoadingFullSource(true);
    try {
      const protectedSource = await requestProtectedSource(imageId, sessionToken);
      if (fullImageRequestRef.current === requestVersion) {
        setFullSource(protectedSource || source);
      }
    } catch {
      if (fullImageRequestRef.current === requestVersion) setFullSource(source);
    } finally {
      if (fullImageRequestRef.current === requestVersion) setLoadingFullSource(false);
    }
  }

  function closeFullImage() {
    fullImageRequestRef.current += 1;
    setOpen(false);
    setFullSource('');
    setLoadingFullSource(false);
  }

  useEffect(() => {
    fullImageRequestRef.current += 1;
    attemptedRef.current = false;
    setFailed(false);
    setOpen(false);
    setFullSource('');
    setLoadingFullSource(false);
    setSource(kind === 'video' ? '' : initialSource);
    if (imageId && (kind === 'video' || !initialSource)) loadProtectedMedia();
    // Solo debe ejecutarse al cambiar de evidencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, initialSource, sessionToken, kind]);

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
      <button type="button" className="maintenance-evidence-image" onClick={openFullImage} aria-label="Abrir evidencia en tamaño completo">
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
        <div className="maintenance-lightbox" role="dialog" aria-modal="true" aria-label="Vista completa de evidencia">
          <button className="maintenance-lightbox__close" type="button" onClick={closeFullImage} aria-label="Cerrar imagen"><Icon name="close" /></button>
          {fullSource ? (
            <img src={fullSource} alt={alt} referrerPolicy="no-referrer" />
          ) : (
            <span className="maintenance-lightbox__loading"><Icon name="progress_activity" /> {loadingFullSource ? 'Cargando imagen original...' : 'Preparando imagen original...'}</span>
          )}
        </div>
      )}
    </>
  );
}
