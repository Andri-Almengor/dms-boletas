import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import KnowledgeDocumentViewer from '../../components/knowledge/KnowledgeDocumentViewer';
import { MODULE_ROUTES, pick, requestAvailable } from '../../services/moduleApi';
import {
  formatKnowledgeDate,
  getAttachmentId,
  getVideoEmbedUrl,
  normalizeKnowledge,
  sanitizeKnowledgeHtml,
  stripHtml,
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

  async function documentAction(route, attachment, confirmation = '', documentOperation = '') {
    if (confirmation && !window.confirm(confirmation)) return;
    try {
      await requestAvailable(route, { tutorialId, adjuntoId: getAttachmentId(attachment), ...(documentOperation ? { documentOperation } : {}) }, sessionToken);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="page page--narrow"><div className="state-card state-card--loading"><Icon name="progress_activity" /> Cargando guía...</div></div>;
  if (!record) return <div className="page page--narrow"><div className="alert alert--error"><Icon name="error" /> {error || 'No se encontró la guía.'}</div></div>;

  const item = normalizeKnowledge(record);
  const categories = item.categories.length ? item.categories : [{ id: '', name: 'Sin categoría' }];
  const currentUserId = String(pick(user, ['UsuarioID', 'id'], ''));
  const canEdit = hasPermission('CONOCIMIENTO_GESTIONAR') || hasPermission('USUARIOS_GESTIONAR') || Boolean(item.authorId && currentUserId && item.authorId === currentUserId);
  const writtenContent = stripHtml(item.content).trim();
  const primaryDocument = item.attachments.find((attachment) => Boolean(pick(attachment, ['IsPrimary', 'isPrimary'], false)))
    || (!writtenContent ? item.attachments[0] : null);
  const remainingDocuments = item.attachments.filter((attachment) => getAttachmentId(attachment) !== getAttachmentId(primaryDocument || {}));
  const primaryId = getAttachmentId(primaryDocument || {});

  return <div className="page knowledge-detail-page">
    <div className="page-header knowledge-detail-header">
      <button className="icon-button" type="button" onClick={() => navigate('/conocimiento')}><Icon name="arrow_back" /></button>
      <div><span className="eyebrow">Base de conocimientos</span><h1>{item.title}</h1></div>
      {canEdit && <Link className="icon-button icon-button--outlined" to={`/conocimiento/${encodeURIComponent(item.id)}/editar`} aria-label="Editar guía"><Icon name="edit" /></Link>}
    </div>

    {error && <div className="alert alert--error"><Icon name="error" /><span>{error}</span></div>}

    <section className="knowledge-detail-meta">
      <div className="knowledge-category-chip-list" aria-label="Categorías de la guía">
        {categories.map((category, index) => (
          <span className={`knowledge-category-chip${index === 0 && categories.length > 1 ? ' is-primary' : ''}`} key={category.id || `${category.name}-${index}`}>
            <Icon name={index === 0 && categories.length > 1 ? 'star' : 'label'} /> {category.name}
          </span>
        ))}
      </div>
      <span className={`status-chip ${item.status === 'BORRADOR' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status}</span>
      <div><span><Icon name="person" /> {item.author}</span><span><Icon name="event" /> Actualizado {formatKnowledgeDate(item.updatedAt || item.createdAt)}</span></div>
    </section>

    {primaryDocument && <section className="knowledge-resources-section knowledge-primary-document">
      <div className="section-heading"><div><span className="eyebrow">Documento principal</span><h2>Contenido documental</h2></div></div>
      <KnowledgeDocumentViewer
        key={primaryId}
        tutorialId={item.id}
        attachment={primaryDocument}
        sessionToken={sessionToken}
        canEdit={canEdit}
        onSetPrimary={(attachment) => documentAction(MODULE_ROUTES.knowledge.attachmentPrimary, attachment, '', 'PRIMARY')}
        onReindex={(attachment) => documentAction(MODULE_ROUTES.knowledge.attachmentReindex, attachment, '', 'REINDEX')}
        onDelete={(attachment) => documentAction(MODULE_ROUTES.knowledge.attachmentDelete, attachment, '¿Eliminar este documento de la guía?')}
        onReplace={() => navigate(`/conocimiento/${encodeURIComponent(item.id)}/editar`)}
      />
    </section>}

    {item.problem && <section className="knowledge-problem-card">
      <span className="knowledge-problem-card__icon"><Icon name="build_circle" /></span>
      <div><span className="eyebrow">Problema que resuelve</span><h2>{item.problem}</h2></div>
    </section>}

    {writtenContent && <article className="knowledge-document" dangerouslySetInnerHTML={{ __html: sanitizeKnowledgeHtml(item.content) }} />}

    {!writtenContent && !primaryDocument && <div className="state-card"><Icon name="description" /> Esta guía todavía no tiene contenido documental disponible.</div>}

    {item.videos.length > 0 && <section className="knowledge-resources-section"><div className="section-heading"><div><span className="eyebrow">Material audiovisual</span><h2>Videos paso a paso</h2></div></div><div className="knowledge-video-grid">{item.videos.map((video, index) => { const url = typeof video === 'string' ? video : pick(video, ['URL', 'Url', 'url']); const embed = getVideoEmbedUrl(url); return <article className="knowledge-video-card" key={`${url}-${index}`}>{embed ? <iframe src={embed} title={`Video ${index + 1}: ${item.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : <a href={url} target="_blank" rel="noopener noreferrer"><Icon name="play_circle" /> Abrir video {index + 1}</a>}</article>; })}</div></section>}

    {remainingDocuments.length > 0 && <section className="knowledge-resources-section">
      <div className="section-heading"><div><span className="eyebrow">Biblioteca de la guía</span><h2>Otros documentos</h2></div></div>
      <div className="knowledge-document-list">
        {remainingDocuments.map((attachment, index) => <KnowledgeDocumentViewer
          compact
          autoLoad={false}
          key={getAttachmentId(attachment) || index}
          tutorialId={item.id}
          attachment={attachment}
          sessionToken={sessionToken}
          canEdit={canEdit}
          onSetPrimary={(document) => documentAction(MODULE_ROUTES.knowledge.attachmentPrimary, document, '', 'PRIMARY')}
          onReindex={(document) => documentAction(MODULE_ROUTES.knowledge.attachmentReindex, document, '', 'REINDEX')}
          onDelete={(document) => documentAction(MODULE_ROUTES.knowledge.attachmentDelete, document, '¿Eliminar este documento de la guía?')}
          onReplace={() => navigate(`/conocimiento/${encodeURIComponent(item.id)}/editar`)}
        />)}
      </div>
    </section>}
  </div>;
}
