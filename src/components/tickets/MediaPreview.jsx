import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';
import { scheduleMediaPreview } from '../../services/mediaPreviewQueue';
import { evidenceMediaKind } from '../../utils/evidenceMedia';

function isProtectedGoogleUrl(value = '') {
  const url = String(value || '').trim();
  return /(?:drive|docs)\.google\.com|googleusercontent\.com/i.test(url);
}

function canUseDirectly(value = '') {
  const url = String(value || '').trim();
  return Boolean(url) && !isProtectedGoogleUrl(url);
}

function mediaRequestKey({ boletaUid, evidenceId, fileId, kind }) {
  return [boletaUid, evidenceId, fileId, kind].map((value) => String(value || '')).join(':');
}

export default function MediaPreview({ boletaUid, evidenceId, fileId, kind = 'evidence', directUrl, mimeType, alt, onOpen }) {
  const { sessionToken, hasPermission } = useAuth();
  const hostRef = useRef(null);
  const loadControllerRef = useRef(null);
  const attemptedRef = useRef(false);
  const directSource = canUseDirectly(directUrl) ? directUrl : '';
  const [source, setSource] = useState(directSource);
  const [nearViewport, setNearViewport] = useState(Boolean(directSource));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signatureRemoved, setSignatureRemoved] = useState(false);
  const [resettingSignature, setResettingSignature] = useState(false);
  const [signatureResetMessage, setSignatureResetMessage] = useState('');
  const canRequestProtected = Boolean(evidenceId || fileId || kind === 'signature');
  const knownKind = evidenceMediaKind({ mimeType, name: alt });
  const canRemoveSignature = kind === 'signature' && Boolean(hasPermission?.('BOLETAS_EDITAR'));

  const loadProtectedMedia = useCallback(async (force = false, priority = 0) => {
    if (!canRequestProtected || (!force && attemptedRef.current)) return '';
    attemptedRef.current = true;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const key = mediaRequestKey({ boletaUid, evidenceId, fileId, kind });
      const data = await scheduleMediaPreview(key, (queueSignal) => requestAvailable(MODULE_ROUTES.tickets.mediaGet, {
        boletaUid,
        evidenciaId: evidenceId,
        EvidenciaID: evidenceId,
        fileId,
        kind,
      }, sessionToken, { signal: queueSignal }), {
        signal: controller.signal,
        priority,
      });
      const resolved = data?.streamUrl || data?.dataUrl || data?.DataURL || data?.url || '';
      if (!resolved) {
        if (data?.missing) throw new Error(data?.message || 'El archivo no está disponible.');
        throw new Error('El backend no devolvió el contenido del archivo.');
      }
      if (!controller.signal.aborted) setSource(resolved);
      return resolved;
    } catch (requestError) {
      if (requestError?.name === 'AbortError') return '';
      setError(requestError.message || 'No se pudo cargar el archivo.');
      if (!canUseDirectly(directUrl)) setSource('');
      return '';
    } finally {
      if (loadControllerRef.current === controller) loadControllerRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [boletaUid, evidenceId, fileId, kind, sessionToken, canRequestProtected, directUrl]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || directSource) {
      setNearViewport(true);
      return undefined;
    }
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
  }, [directSource, boletaUid, evidenceId, fileId, kind]);

  useEffect(() => {
    setSignatureRemoved(false);
    setSignatureResetMessage('');
    attemptedRef.current = false;
    loadControllerRef.current?.abort();
    setError('');
    setLoading(false);
    setSource(directSource);

    const needsProtectedMedia = Boolean(evidenceId)
      || kind === 'signature'
      || Boolean(fileId && (!directSource || isProtectedGoogleUrl(directUrl)));
    if (nearViewport && needsProtectedMedia) loadProtectedMedia(false, 10);
    else if (nearViewport && !directSource && !needsProtectedMedia) setError('El registro no tiene un archivo disponible.');

    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [boletaUid, evidenceId, fileId, kind, directUrl, sessionToken, directSource, nearViewport, loadProtectedMedia]);

  const resolvedKind = String(source || '').startsWith('data:video/')
    ? 'video'
    : String(source || '').startsWith('data:image/')
      ? 'image'
      : knownKind;

  async function retry() {
    attemptedRef.current = false;
    setNearViewport(true);
    await loadProtectedMedia(true, 100);
  }

  async function removeSignature() {
    if (!canRemoveSignature || resettingSignature) return;
    if (!window.confirm('¿Quitar la firma del cliente? El mismo enlace público quedará habilitado para que pueda firmar nuevamente.')) return;

    setResettingSignature(true);
    setError('');
    setSignatureResetMessage('');
    try {
      const result = await requestAvailable(MODULE_ROUTES.tickets.signatureUpload, {
        boletaUid,
        reset: true,
      }, sessionToken);
      loadControllerRef.current?.abort();
      attemptedRef.current = true;
      setSource('');
      setSignatureRemoved(true);
      setSignatureResetMessage(result?.message || 'Firma quitada. El enlace quedó habilitado para firmar nuevamente.');
      window.dispatchEvent(new CustomEvent('dms-ticket-signature-reset', {
        detail: {
          boletaUid,
          request: result?.request || null,
          reusedLink: Boolean(result?.reusedLink),
        },
      }));
    } catch (requestError) {
      setError(requestError.message || 'No se pudo quitar la firma.');
    } finally {
      setResettingSignature(false);
    }
  }

  return (
    <div ref={hostRef} className="media-preview-host">
      {signatureRemoved ? (
        <div className="media-error"><Icon name="draw" /><span>{signatureResetMessage || 'Firma pendiente'}</span></div>
      ) : (
        <>
          {!nearViewport && !source && <div className="media-loading media-loading--deferred"><Icon name={knownKind === 'video' ? 'videocam' : knownKind === 'image' ? 'image' : 'description'} /> <span>Vista previa</span></div>}
          {nearViewport && loading && !source && <div className="media-loading"><Icon name="progress_activity" /> Cargando...</div>}
          {nearViewport && error && !source && <div className="media-error"><Icon name="broken_image" /> <span>{error}</span>{canRequestProtected && <button type="button" onClick={retry}>Reintentar</button>}</div>}
          {nearViewport && !loading && !error && !source && <div className="media-error"><Icon name="hide_image" /><span>Archivo no disponible</span></div>}

          {source && resolvedKind === 'video' && (
            <div className="media-preview-video">
              <video src={source} controls preload="metadata" playsInline aria-label={alt || 'Video de evidencia'} />
              {loading && <span className="media-preview-button__loading"><Icon name="progress_activity" /></span>}
            </div>
          )}

          {source && resolvedKind !== 'video' && resolvedKind !== 'image' && (
            <a className="evidence-file-link" href={source} target="_blank" rel="noreferrer"><Icon name="description" /> Abrir archivo</a>
          )}

          {source && resolvedKind === 'image' && (
            <button className="media-preview-button" type="button" onClick={() => onOpen?.(source)} aria-label={`Abrir ${alt || 'evidencia'}`}>
              <img
                src={source}
                alt={alt || 'Evidencia'}
                loading="lazy"
                decoding="async"
                onError={() => {
                  setSource('');
                  setError('No se pudo mostrar la imagen.');
                }}
              />
              {loading && <span className="media-preview-button__loading"><Icon name="progress_activity" /></span>}
            </button>
          )}
        </>
      )}

      {canRemoveSignature && !signatureRemoved && (
        <button
          className="button button--secondary button--compact"
          type="button"
          disabled={resettingSignature}
          onClick={removeSignature}
        >
          <Icon name="delete" /> {resettingSignature ? 'Quitando firma...' : 'Quitar firma'}
        </button>
      )}
    </div>
  );
}
