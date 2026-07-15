import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import { formatKnowledgeDate, normalizeKnowledge, stripHtml } from '../../utils/knowledge';

export default function KnowledgeCard({ record }) {
  const navigate = useNavigate();
  const item = normalizeKnowledge(record);
  const excerpt = item.problem || stripHtml(item.content) || 'Documento técnico sin descripción.';
  const detailUrl = item.id ? `/conocimiento/${encodeURIComponent(item.id)}` : '';

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
    <div className="knowledge-card__top">
      <span className="knowledge-card__icon"><Icon name="menu_book" /></span>
      <span className={`status-chip ${item.status === 'BORRADOR' ? 'status-chip--inactive' : 'status-chip--active'}`}>{item.status === 'BORRADOR' ? 'BORRADOR' : 'PUBLICADO'}</span>
    </div>
    <span className="knowledge-category-chip"><Icon name="label" /> {item.category}</span>
    <h2>{item.title}</h2>
    <p>{excerpt}</p>
    <div className="knowledge-card__meta">
      <span><Icon name="person" /> {item.author}</span>
      <span><Icon name="event" /> {formatKnowledgeDate(item.updatedAt || item.createdAt)}</span>
    </div>
    <div className="knowledge-card__resources">
      <span><Icon name="play_circle" /> {item.videos.length} video{item.videos.length === 1 ? '' : 's'}</span>
      <span><Icon name="attach_file" /> {item.attachments.length} archivo{item.attachments.length === 1 ? '' : 's'}</span>
    </div>
    <Link className="button button--primary button--wide" to={detailUrl}>Abrir tutorial <Icon name="arrow_forward" /></Link>
  </article>;
}
