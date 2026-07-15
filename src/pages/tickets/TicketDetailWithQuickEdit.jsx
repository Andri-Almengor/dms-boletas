import React, { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import TicketDetailPage from './TicketDetailPage';

const SECTION_ROUTES = {
  'informacion general': 'general',
  cliente: 'client',
  'dispositivo / equipo': 'device',
  'trabajo realizado': 'work',
};

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export default function TicketDetailWithQuickEdit() {
  const hostRef = useRef(null);
  const navigate = useNavigate();
  const { boletaUid } = useParams();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('BOLETAS_EDITAR');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canEdit) return undefined;

    function enhance() {
      const fullEditLink = host.querySelector('.ticket-detail-actions a[href$="/editar"]');
      const editable = Boolean(fullEditLink);
      host.querySelectorAll('.ticket-detail-section > summary').forEach((summary) => {
        const title = normalized(summary.querySelector('strong')?.textContent);
        const section = SECTION_ROUTES[title];
        const existing = summary.querySelector('.ticket-detail-section__quick-edit');
        if (!section || !editable) {
          existing?.remove();
          return;
        }
        if (existing) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ticket-detail-section__quick-edit';
        button.setAttribute('aria-label', `Editar rápidamente ${summary.querySelector('strong')?.textContent || 'sección'}`);
        button.title = 'Edición rápida';
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">edit</span><span>Editar</span>';
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          navigate(`/boletas/${encodeURIComponent(boletaUid)}/editar-rapido/${section}`);
        });
        const expandIcon = summary.lastElementChild;
        summary.insertBefore(button, expandIcon || null);
      });
    }

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [boletaUid, canEdit, navigate]);

  return <div ref={hostRef} className="ticket-detail-quick-edit-host"><TicketDetailPage /></div>;
}
