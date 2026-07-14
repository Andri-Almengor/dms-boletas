import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  formatKnowledgeDate,
  getAttachmentId,
  getAttachmentName,
  getAttachmentUrl,
  getVideoEmbedUrl,
  normalizeKnowledge,
  sanitizeKnowledgeHtml,
} from '../../utils/knowledge';

export default function KnowledgeDetailPage() {
  const { tutorialId } = useParams();
  const navigate = useNavigate();
  const { sessionToken, user, hasPermission } = useAuth();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(MODULE_ROUTES.knowledge.get, { tutorialId, TutorialID: tutorialId }, sessionToken);
      setRecord(data?.item || data?.data || data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tutorialId, sessionToken]);

  async function openAttachment(attachment) {
    const attachmentId = getAttachmentId(attachment);
    const directUrl = getAttachmentUrl(attachment);
    if (!attachmentId) {
      if (directUrl) window.open(directUrl, '_blank', 'noopener,noreferrer');
      else setError('El archivo no tiene un identificador o enlace válido.');
      return;
    }

    const target = window.open('', '_blank');
    try {
      const data = await requestAvailable(MODULE_ROUTES.knowledge.mediaGet, { tutorialId, adjuntoId: attachmentId }, sessionToken);
      const url = pick(data, ['dataUrl', 'DataURL', 'url', 'URL', 'DriveURL'], directUrl);
      if (!url) throw new Error('El backend no devolvió contenido para el archivo.');
      if (target) {
        target.opener = null;
        target.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      target?.close();
      setError(err.message);
    }
  }

  if (loading) return <div className="page page--narrow"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando tutorial...</div></div>;
  if (!record) return <div className="page page--narrow"><div className="alert alert--error"><Icon name="error" /> {error || 'No se encontró el tutorial.'}</div></div>;

  const item = normalizeKnowledge(record);
  const currentUserId = String(pick(user, ['UsuarioID', 'id'], ''));
  const canEdit = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR') || Boolean(item.authorId && currentUserId && item.authorId === currentUserId);

  return <div className="page knowledge-detail-page">
    <div className="page-header knowledge-detail-header">
      <button className="icon-button" type="button" onClick={() => navigate('/conocimiento')}><Icon name="arrow_back" /></button>
      <div><span className="eyebrow">Base de conocimientos</span><h1>{item.title}</h1></div>
      {canEdit && <Link className="icon-button icon-button--outlined" to={`/conocimiento/${encodeURIComponent(item.id)}/editar`} aria-label="Editar tutorial"><Icon name="edit" /></Link>}
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    <section className="knowledge-detail-meta">
      <span className="knowledge-category-chip"><Icon name="label" /> {item.category}</span>
      <span className={`status-chip ${item.status === 'BORRADOR' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status}</span>
      <div><span><Icon name="person" /> {item.author}</span><span><Icon name="event" /> Actualizado {formatKnowledgeDate(item.updatedAt || item.createdAt)}</span></div>
    </section>

    <section className="knowledge-problem-card">
      <span className="knowledge-problem-card__icon"><Icon name="build_circle" /></span>
      <div><span className="eyebrow">Problema que resuelve</span><h2>{item.problem || 'Sin descripción del problema.'}</h2></div>
    </section>

    <article className="knowledge-document" dangerouslySetInnerHTML={{ __html: sanitizeKnowledgeHtml(item.content) || '<p>Este tutorial todavía no tiene contenido.</p>' }} />

    {item.videos.length > 0 && <section className="knowledge-resources-section"><div className="section-heading"><div><span className="eyebrow">Material audiovisual</span><h2>Videos paso a paso</h2></div></div><div className="knowledge-video-grid">{item.videos.map((video, index) => { const url = typeof video === 'string' ? video : pick(video, ['URL', 'Url', 'url']); const embed = getVideoEmbedUrl(url); return <article className="knowledge-video-card" key={`${url}-${index}`}>{embed ? <iframe src={embed} title={`Video ${index + 1}: ${item.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : <a href={url} target="_blank" rel="noopener noreferrer"><Icon name="play_circle" /> Abrir video {index + 1}</a>}</article>; })}</div></section>}

    {item.attachments.length > 0 && <section className="knowledge-resources-section"><div className="section-heading"><div><span className="eyebrow">Archivos relacionados</span><h2>Documentos adjuntos</h2></div></div><div className="knowledge-attachment-list">{item.attachments.map((attachment, index) => <button type="button" key={getAttachmentId(attachment) || index} onClick={() => openAttachment(attachment)}><span><Icon name="description" /></span><div><strong>{getAttachmentName(attachment)}</strong><small>{pick(attachment, ['MimeType', 'mimeType'], 'Documento')}</small></div><Icon name="open_in_new" /></button>)}</div></section>}
  </div>;
}
