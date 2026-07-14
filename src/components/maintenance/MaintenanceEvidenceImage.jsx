import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';

function isProtectedDriveUrl(value) {
  const source = String(value || '').toLowerCase();
  return source.includes('drive.google.com') || source.includes('docs.google.com');
}

export default function MaintenanceEvidenceImage({ image, sessionToken, alt = 'Evidencia' }) {
  const imageId = String(pick(image, ['FotoDispositivoID', 'id']));
  const rawInitialSource = pick(image, ['PreviewURL', 'DriveURL', 'url']);
  const initialSource = useMemo(() => isProtectedDriveUrl(rawInitialSource) ? '' : rawInitialSource, [rawInitialSource]);
  const [source, setSource] = useState(initialSource);
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSource(initialSource);
    setFailed(false);
    setFallbackAttempted(false);
  }, [imageId, initialSource]);

  async function loadProtectedImage(force = false) {
    if (!imageId || (!force && fallbackAttempted) || loadingFallback) {
      if (!loadingFallback) setFailed(true);
      return;
    }

    setFallbackAttempted(true);
    setLoadingFallback(true);
    setSource('');
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
    } finally {
      setLoadingFallback(false);
    }
  }

  useEffect(() => {
    if ((!initialSource || isProtectedDriveUrl(rawInitialSource)) && imageId) loadProtectedImage();
    // Solo debe ejecutarse al cambiar de imagen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, initialSource, rawInitialSource]);

  if (failed) {
    return (
      <div className="maintenance-evidence-image maintenance-evidence-image--error">
        <Icon name="broken_image" />
        <span>No se pudo cargar</span>
        <button type="button" onClick={() => { setFailed(false); setFallbackAttempted(false); loadProtectedImage(true); }}>
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
          <img src={source} alt={alt} loading="lazy" onError={() => loadProtectedImage(false)} />
        ) : (
          <span className="maintenance-evidence-image__loading"><Icon name="progress_activity" /> Cargando...</span>
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
