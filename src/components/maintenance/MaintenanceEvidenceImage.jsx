import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function isProtectedGoogleUrl(value = '') {
  return /(?:drive|docs)\.google\.com|googleusercontent\.com/i.test(String(value || ''));
}

export default function MaintenanceEvidenceImage({ image, sessionToken, alt = 'Evidencia' }) {
  const imageId = String(pick(image, ['FotoDispositivoID', 'id']));
  const initialSource = pick(image, ['PreviewURL', 'DriveURL', 'url']);
  const initialDirectSource = imageId && isProtectedGoogleUrl(initialSource) ? '' : initialSource;
  const attemptedRef = useRef(false);
  const [source, setSource] = useState(initialDirectSource);
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  async function loadProtectedImage(force = false) {
    if (!imageId || (!force && attemptedRef.current) || loadingFallback) {
      if (!imageId) setFailed(true);
      return;
    }

    attemptedRef.current = true;
    setLoadingFallback(true);
    setFailed(false);
    if (isProtectedGoogleUrl(initialSource)) setSource('');
    try {
      const media = await requestAvailable(
        MODULE_ROUTES.maintenance.mediaGet,
        { imageId, FotoDispositivoID: imageId },
        sessionToken,
      );
      const protectedSource = pick(media, ['dataUrl', 'DataURL', 'url']);
      if (!protectedSource) throw new Error('La imagen no devolvió contenido.');
      setSource(protectedSource);
      setFailed(false);
    } catch {
      setFailed(true);
      if (isProtectedGoogleUrl(initialSource)) setSource('');
    } finally {
      setLoadingFallback(false);
    }
  }

  useEffect(() => {
    attemptedRef.current = false;
    setFailed(false);
    setOpen(false);
    const directSource = imageId && isProtectedGoogleUrl(initialSource) ? '' : initialSource;
    setSource(directSource);
    if (imageId && (!initialSource || isProtectedGoogleUrl(initialSource))) loadProtectedImage();
    // Solo debe ejecutarse al cambiar de imagen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, initialSource, sessionToken]);

  if (failed && !source) {
    return (
      <div className="maintenance-evidence-image maintenance-evidence-image--error">
        <Icon name="broken_image" />
        <span>No se pudo cargar</span>
        <button type="button" onClick={() => { attemptedRef.current = false; setFailed(false); loadProtectedImage(true); }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="maintenance-evidence-image"
        onClick={() => source && setOpen(true)}
        aria-label="Abrir evidencia en tamaño completo"
      >
        {source ? (
          <img
            src={source}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (imageId && !attemptedRef.current) loadProtectedImage();
              else setFailed(true);
            }}
          />
        ) : (
          <span className="maintenance-evidence-image__loading"><Icon name="progress_activity" /> {loadingFallback ? 'Cargando...' : 'Preparando imagen...'}</span>
        )}
        <span className="maintenance-evidence-image__zoom"><Icon name="zoom_in" /></span>
      </button>

      {open && source && (
        <div className="maintenance-lightbox" role="dialog" aria-modal="true" aria-label="Vista completa de evidencia">
          <button className="maintenance-lightbox__close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar imagen">
            <Icon name="close" />
          </button>
          <img src={source} alt={alt} />
        </div>
      )}
    </>
  );
}
