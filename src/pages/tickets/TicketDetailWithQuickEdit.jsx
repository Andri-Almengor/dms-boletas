import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Icon from '../../components/common/Icon';
import { requestAvailable } from '../../services/moduleApi';
import TicketDetailPage from './TicketDetailPage';

const SECTION_ROUTES = {
  'informacion general': 'general',
  cliente: 'client',
  'dispositivo / equipo': 'device',
  'trabajo realizado': 'work',
};

const SIGNATURE_LINK_ROUTES = ['ticket.signature.link', 'boletas.signature.link', 'boletas.firma.enlace'];

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function TicketPublicSignatureCard({ info, loading, error }) {
  const request = info?.request || null;
  const signed = Boolean(info?.signed || request?.status === 'FIRMADA');
  const url = request?.url || '';
  const [notice, setNotice] = useState('');

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Enlace copiado.');
    } catch {
      window.prompt('Copie el enlace para enviarlo al cliente:', url);
    }
  }

  async function shareLink() {
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Firma de boleta #${info?.ticket?.number || ''}`,
          text: 'Abra este enlace para firmar la boleta de servicio de DMS.',
          url,
        });
      } else {
        await copyLink();
      }
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') setNotice('No se pudo compartir. Use el botón Copiar enlace.');
    }
  }

  if (loading) {
    return <div className="ticket-public-signature-card"><div className="ticket-public-signature-card__heading"><Icon name="progress_activity" /><div><strong>Preparando enlace de firma</strong><span>Espere un momento...</span></div></div></div>;
  }

  if (signed) {
    return <div className="ticket-public-signature-card ticket-public-signature-card--signed"><div className="ticket-public-signature-card__heading"><Icon name="verified" filled /><div><strong>Firma del cliente registrada</strong><span>El enlace público ya fue completado y la boleta cuenta con firma.</span></div></div></div>;
  }

  if (error) {
    return <div className="ticket-public-signature-card"><div className="ticket-public-signature-card__heading"><Icon name="warning" /><div><strong>No se pudo preparar el enlace de firma</strong><span>{error}</span></div></div></div>;
  }

  if (!url) return null;

  return (
    <div className="ticket-public-signature-card">
      <div className="ticket-public-signature-card__heading">
        <Icon name="link" />
        <div>
          <strong>Enlace para que el cliente firme</strong>
          <span>Comparta únicamente este enlace. El cliente podrá dibujar la firma y presionar Guardar.</span>
        </div>
      </div>
      <input className="ticket-public-signature-card__link" value={url} readOnly aria-label="Enlace público de firma" onFocus={(event) => event.target.select()} />
      <div className="ticket-public-signature-card__actions">
        <button className="button button--secondary button--compact" type="button" onClick={copyLink}><Icon name="content_copy" /> Copiar enlace</button>
        <button className="button button--primary button--compact" type="button" onClick={shareLink}><Icon name="share" /> Compartir con cliente</button>
        <a className="button button--ghost button--compact" href={url} target="_blank" rel="noreferrer"><Icon name="open_in_new" /> Probar enlace</a>
      </div>
      {notice && <small className="field-hint">{notice}</small>}
    </div>
  );
}

export default function TicketDetailWithQuickEdit() {
  const hostRef = useRef(null);
  const navigate = useNavigate();
  const { boletaUid } = useParams();
  const { hasPermission, sessionToken } = useAuth();
  const canEdit = hasPermission('BOLETAS_EDITAR');
  const [signaturePortal, setSignaturePortal] = useState(null);
  const [signatureInfo, setSignatureInfo] = useState(null);
  const [signatureLoading, setSignatureLoading] = useState(true);
  const [signatureError, setSignatureError] = useState('');

  useEffect(() => {
    let active = true;
    setSignatureLoading(true);
    setSignatureError('');
    requestAvailable(SIGNATURE_LINK_ROUTES, { boletaUid, id: boletaUid }, sessionToken)
      .then((data) => { if (active) setSignatureInfo(data); })
      .catch((error) => { if (active) setSignatureError(error.message); })
      .finally(() => { if (active) setSignatureLoading(false); });
    return () => { active = false; };
  }, [boletaUid, sessionToken]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    function enhance() {
      if (canEdit) {
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

      const signatureHeading = [...host.querySelectorAll('.section-heading h2')]
        .find((heading) => normalized(heading.textContent) === 'firma del cliente');
      const signatureSection = signatureHeading?.closest('.section-block');
      if (signatureSection) {
        let portalHost = signatureSection.querySelector('.ticket-public-signature-portal');
        if (!portalHost) {
          portalHost = document.createElement('div');
          portalHost.className = 'ticket-public-signature-portal';
          const display = signatureSection.querySelector('.signature-display, .ticket-signature-editor');
          if (display?.nextSibling) signatureSection.insertBefore(portalHost, display.nextSibling);
          else signatureSection.appendChild(portalHost);
        }
        setSignaturePortal((current) => current === portalHost ? current : portalHost);
      }
    }

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [boletaUid, canEdit, navigate]);

  return (
    <div ref={hostRef} className="ticket-detail-quick-edit-host">
      <TicketDetailPage />
      {signaturePortal && createPortal(
        <TicketPublicSignatureCard
          info={signatureInfo}
          loading={signatureLoading}
          error={signatureError}
        />,
        signaturePortal,
      )}
    </div>
  );
}
