import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../common/Icon';
import { formatKnowledgeDate, normalizeKnowledge, stripHtml } from '../../utils/knowledge';

export default function KnowledgeCard({ record }) {
  const item = normalizeKnowledge(record);
  const excerpt = item.problem || stripHtml(item.content) || 'Documento técnico sin descripción.';
  return <article className="knowledge-card">
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
    <Link className="button button--primary button--wide" to={`/conocimiento/${encodeURIComponent(item.id)}`}>Abrir tutorial <Icon name="arrow_forward" /></Link>
  </article>;
}
