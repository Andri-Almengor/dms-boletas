import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import Icon from '../common/Icon';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

function isDriveUrl(value) {
  const url = String(value || '').toLowerCase();
  return url.includes('drive.google.com') || url.includes('docs.google.com');
}

function usableDirectSource(value) {
  const source = String(value || '').trim();
  if (!source || isDriveUrl(source)) return '';
  return source;
}

export default function MediaPreview({ boletaUid, evidenceId, fileId, directUrl, mimeType, alt, onOpen }) {
  const { sessionToken } = useAuth();
  const initialDirectSource = useMemo(() => usableDirectSource(directUrl), [directUrl]);
  const [source, setSource] = useState(initialDirectSource);
  const [resolvedMimeType, setResolvedMimeType] = useState(mimeType || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const hasProtectedReference = Boolean(evidenceId || fileId || (directUrl && isDriveUrl(directUrl)));

    setError('');
    setResolvedMimeType(mimeType || '');
    if (!hasProtectedReference) {
      setSource(initialDirectSource);
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    setSource('');
    requestAvailable(MODULE_ROUTES.tickets.mediaGet, {
      boletaUid,
      evidenciaId: evidenceId,
      fileId,
      directUrl,
    }, sessionToken)
      .then((data) => {
        if (!active) return;
        const nextSource = data?.dataUrl || usableDirectSource(directUrl);
        if (!nextSource) throw new Error('El backend no devolvió contenido para el archivo.');
        setSource(nextSource);
        setResolvedMimeType(data?.mimeType || mimeType || '');
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'No se pudo cargar el archivo.');
        setSource(initialDirectSource);
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [boletaUid, evidenceId, fileId, directUrl, mimeType, sessionToken, initialDirectSource, reloadToken]);

  const image = String(resolvedMimeType || mimeType || '').startsWith('image/') || String(source || '').startsWith('data:image/');

  if (loading && !source) return <div className="media-loading"><Icon name="progress_activity" /> Cargando...</div>;
  if (error && !source) return <div className="media-error"><Icon name="broken_image" /><span>No se pudo cargar</span><button type="button" onClick={() => setReloadToken((value) => value + 1)}>Reintentar</button></div>;
  if (!source) return <div className="media-error"><Icon name="broken_image" /> Archivo no disponible</div>;
  if (!image) return <a className="evidence-file-link" href={source} target="_blank" rel="noreferrer"><Icon name="description" /> Abrir archivo</a>;

  return <button className="media-preview-button" type="button" onClick={() => onOpen?.(source)}><img src={source} alt={alt || 'Evidencia'} loading="lazy" onError={() => { setSource(''); setError('No se pudo mostrar la imagen.'); }} /></button>;
}
