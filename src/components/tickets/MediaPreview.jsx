import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

function isProtectedGoogleUrl(value = '') {
  const url = String(value || '').trim();
  return /(?:drive|docs)\.google\.com|googleusercontent\.com/i.test(url);
}

function canUseDirectly(value = '') {
  const url = String(value || '').trim();
  return Boolean(url) && !isProtectedGoogleUrl(url);
}

export default function MediaPreview({ boletaUid, evidenceId, fileId, kind = 'evidence', directUrl, mimeType, alt, onOpen }) {
  const { sessionToken } = useAuth();
  const attemptedRef = useRef(false);
  const [source, setSource] = useState(canUseDirectly(directUrl) ? directUrl : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canRequestProtected = Boolean(evidenceId || fileId || kind === 'signature');

  async function loadProtectedMedia(force = false) {
    if (!canRequestProtected || (!force && attemptedRef.current)) return;
    attemptedRef.current = true;
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.tickets.mediaGet, {
        boletaUid,
        evidenciaId: evidenceId,
        EvidenciaID: evidenceId,
        fileId,
        kind,
      }, sessionToken);
      const resolved = data?.dataUrl || data?.DataURL || data?.url || '';
      if (!resolved) throw new Error('El backend no devolvió el contenido del archivo.');
      setSource(resolved);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo cargar el archivo.');
      if (!canUseDirectly(directUrl)) setSource('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    attemptedRef.current = false;
    setError('');
    const directSource = canUseDirectly(directUrl) ? directUrl : '';
    setSource(directSource);

    const needsProtectedMedia = Boolean(evidenceId)
      || kind === 'signature'
      || Boolean(fileId && (!directSource || isProtectedGoogleUrl(directUrl)));
    if (needsProtectedMedia) loadProtectedMedia();
    else if (!directSource) setError('El registro no tiene un archivo disponible.');
    // Se reinicia únicamente cuando cambia el archivo mostrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boletaUid, evidenceId, fileId, kind, directUrl, sessionToken]);

  const image = String(mimeType || '').startsWith('image/') || String(source || '').startsWith('data:image/');

  if (loading && !source) return <div className="media-loading"><Icon name="progress_activity" /> Cargando...</div>;
  if (error && !source) return <div className="media-error"><Icon name="broken_image" /> <span>{error}</span>{canRequestProtected && <button type="button" onClick={() => { attemptedRef.current = false; loadProtectedMedia(true); }}>Reintentar</button>}</div>;
  if (!source) return <div className="media-error"><Icon name="hide_image" /><span>Archivo no disponible</span></div>;
  if (!image) return <a className="evidence-file-link" href={source} target="_blank" rel="noreferrer"><Icon name="description" /> Abrir archivo</a>;

  return (
    <button className="media-preview-button" type="button" onClick={() => onOpen?.(source)} aria-label={`Abrir ${alt || 'evidencia'}`}>
      <img
        src={source}
        alt={alt || 'Evidencia'}
        loading="lazy"
        decoding="async"
        onError={() => {
          setSource('');
          setError('No se pudo mostrar la imagen.');
          if (!attemptedRef.current && canRequestProtected) loadProtectedMedia();
        }}
      />
      {loading && <span className="media-preview-button__loading"><Icon name="progress_activity" /></span>}
    </button>
  );
}
