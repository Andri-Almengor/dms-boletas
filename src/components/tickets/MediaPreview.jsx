import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import {
  requestTicketProtectedSource,
  ticketMediaPreviewSource,
} from '../../services/ticketMediaSource';
import { evidenceMediaKind } from '../../utils/evidenceMedia';

export default function MediaPreview({
  boletaUid,
  evidenceId,
  fileId,
  kind = 'evidence',
  directUrl,
  mimeType,
  mediaKind,
  alt,
  onOpen,
}) {
  const { sessionToken } = useAuth();
  const hostRef = useRef(null);
  const loadControllerRef = useRef(null);
  const attemptedRef = useRef(false);
  const [fullSource, setFullSource] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mediaKindHint = String(mediaKind || '').toLowerCase();
  const knownKind = mediaKindHint.includes('video')
    ? 'video'
    : (mediaKindHint.includes('imagen') || mediaKindHint.includes('image'))
      ? 'image'
      : evidenceMediaKind({ mimeType, name: alt });
  const previewSource = useMemo(() => ticketMediaPreviewSource({
    directUrl,
    fileId,
    mimeType,
    mediaKind,
    alt,
    kind,
  }), [directUrl, fileId, mimeType, mediaKind, alt, kind]);
  const canRequestProtected = Boolean(evidenceId || fileId || kind === 'signature');
  const imageSource = !previewFailed && previewSource ? previewSource : fullSource;

  const loadProtectedMedia = useCallback(async (force = false, priority = 0) => {
    if (!canRequestProtected || (!force && attemptedRef.current && fullSource)) return fullSource;
    attemptedRef.current = true;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const resolved = await requestTicketProtectedSource({
        boletaUid,
        evidenceId,
        fileId,
        kind,
        sessionToken,
      }, {
        signal: controller.signal,
        priority,
        force,
      });
      if (!controller.signal.aborted) setFullSource(resolved);
      return resolved;
    } catch (requestError) {
      if (requestError?.name === 'AbortError') return '';
      if (!controller.signal.aborted) {
        setError(requestError.message || 'No se pudo cargar el archivo.');
        if (!previewSource) setFullSource('');
      }
      return '';
    } finally {
      if (loadControllerRef.current === controller) loadControllerRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [
    boletaUid,
    evidenceId,
    fileId,
    kind,
    sessionToken,
    canRequestProtected,
    fullSource,
    previewSource,
  ]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [boletaUid, evidenceId, fileId, kind]);

  useEffect(() => {
    attemptedRef.current = false;
    loadControllerRef.current?.abort();
    setError('');
    setLoading(false);
    setFullSource('');
    setPreviewFailed(false);

    const shouldLoadOriginalNow = knownKind !== 'image' || !previewSource;
    if (nearViewport && shouldLoadOriginalNow && canRequestProtected) loadProtectedMedia(false, 10);
    else if (nearViewport && !previewSource && !canRequestProtected) {
      setError('El registro no tiene un archivo disponible.');
    }

    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [
    boletaUid,
    evidenceId,
    fileId,
    kind,
    sessionToken,
    nearViewport,
    knownKind,
    previewSource,
    canRequestProtected,
  ]);

  const warmOriginal = useCallback(() => {
    if (knownKind !== 'image' || !canRequestProtected) return;
    loadProtectedMedia(false, 100).catch(() => {});
  }, [knownKind, canRequestProtected, loadProtectedMedia]);

  async function retry() {
    attemptedRef.current = false;
    setNearViewport(true);
    setPreviewFailed(true);
    await loadProtectedMedia(true, 200);
  }

  function openImage() {
    onOpen?.({
      previewSource: imageSource,
      fullSource,
      evidenceId,
      fileId,
      kind,
      directUrl,
      mimeType,
      mediaKind,
      alt,
    });
  }

  return (
    <div ref={hostRef} className="media-preview-host">
      {!nearViewport && !imageSource && <div className="media-loading media-loading--deferred"><Icon name={knownKind === 'video' ? 'videocam' : knownKind === 'image' ? 'image' : 'description'} /> <span>Vista previa</span></div>}
      {nearViewport && loading && !imageSource && !fullSource && <div className="media-loading"><Icon name="progress_activity" /> Cargando...</div>}
      {nearViewport && error && !imageSource && !fullSource && <div className="media-error"><Icon name="broken_image" /> <span>{error}</span>{canRequestProtected && <button type="button" onClick={retry}>Reintentar</button>}</div>}
      {nearViewport && !loading && !error && !imageSource && !fullSource && <div className="media-error"><Icon name="hide_image" /><span>Archivo no disponible</span></div>}

      {fullSource && knownKind === 'video' && (
        <div className="media-preview-video">
          <video src={fullSource} controls preload="metadata" playsInline aria-label={alt || 'Video de evidencia'} />
          {loading && <span className="media-preview-button__loading"><Icon name="progress_activity" /></span>}
        </div>
      )}

      {fullSource && knownKind !== 'video' && knownKind !== 'image' && (
        <a className="evidence-file-link" href={fullSource} target="_blank" rel="noreferrer"><Icon name="description" /> Abrir archivo</a>
      )}

      {imageSource && knownKind === 'image' && (
        <button
          className="media-preview-button"
          type="button"
          onClick={openImage}
          onPointerEnter={warmOriginal}
          onFocus={warmOriginal}
          aria-label={`Abrir ${alt || 'evidencia'}`}
        >
          <img
            src={imageSource}
            alt={alt || 'Evidencia'}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!previewFailed && previewSource) {
                setPreviewFailed(true);
                if (!fullSource) loadProtectedMedia(false, 150);
                return;
              }
              setError('No se pudo mostrar la imagen.');
            }}
          />
          {loading && !previewSource && <span className="media-preview-button__loading"><Icon name="progress_activity" /></span>}
        </button>
      )}
    </div>
  );
}
