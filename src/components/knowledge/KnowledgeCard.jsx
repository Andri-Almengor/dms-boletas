import React, { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import { formatKnowledgeDate, normalizeKnowledge, stripHtml } from '../../utils/knowledge';

function KnowledgeCard({ record }) {
  const navigate = useNavigate();
  const item = normalizeKnowledge(record);
  const primaryDocument = item.attachments.find((attachment) => Boolean(attachment?.IsPrimary ?? attachment?.isPrimary)) || item.attachments[0];
  const mimeType = String(primaryDocument?.MimeType || primaryDocument?.mimeType || '').toLowerCase();
  const excerpt = item.problem || stripHtml(item.content) || (primaryDocument ? 'Guía documental interna.' : 'Documento técnico sin descripción.');
  const cardIcon = primaryDocument ? (mimeType === 'application/pdf' ? 'picture_as_pdf' : 'description') : 'menu_book';
  const detailUrl = item.id ? `/conocimiento/${encodeURIComponent(item.id)}` : '';
  const categories = item.categories.length ? item.categories : [{ id: '', name: 'Sin categoría' }];

  function openDetail(event) {
    if (!detailUrl || event.target.closest('a, button, input, select, textarea, label')) return;
    navigate(detailUrl);
  }

  function openWithKeyboard(event) {
    if (!detailUrl || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(detailUrl);
  }

  return <article
    className={`knowledge-card${detailUrl ? ' detail-clickable-card' : ''}`}
    onClick={openDetail}
    onKeyDown={openWithKeyboard}
    role={detailUrl ? 'link' : undefined}
    tabIndex={detailUrl ? 0 : undefined}
    aria-label={detailUrl ? `Abrir tutorial ${item.title}` : undefined}
  >
    <div className="knowledge-card__top"><span className="knowledge-card__icon"><Icon name={cardIcon} /></span><span className={`status-chip ${item.status === 'BORRADOR' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status === 'BORRADOR' ? 'BORRADOR' : 'PUBLICADO'}</span></div>
    <div className="knowledge-category-chip-list" aria-label="Categorías del tutorial">
      {categories.map((category, index) => <span className={`knowledge-category-chip${index === 0 && categories.length > 1 ? ' is-primary' : ''}`} key={category.id || `${category.name}-${index}`}><Icon name={index === 0 && categories.length > 1 ? 'star' : 'label'} /> {category.name}</span>)}
    </div>
    <h2>{item.title}</h2>
    <p>{excerpt}</p>
    <div className="knowledge-card__meta"><span><Icon name="person" /> {item.author}</span><span><Icon name="event" /> {formatKnowledgeDate(item.updatedAt || item.createdAt)}</span></div>
    <div className="knowledge-card__resources"><span><Icon name="play_circle" /> {item.videos.length} video{item.videos.length === 1 ? '' : 's'}</span><span><Icon name="attach_file" /> {item.attachments.length} documento{item.attachments.length === 1 ? '' : 's'}</span></div>
    <Link className="button button--primary button--wide" to={detailUrl}>Abrir tutorial <Icon name="arrow_forward" /></Link>
  </article>;
}

export default memo(KnowledgeCard);
