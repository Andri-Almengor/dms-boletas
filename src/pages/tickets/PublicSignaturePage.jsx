import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import SignaturePad from '../../components/tickets/SignaturePad';
import { requestAvailable } from '../../services/moduleApi';

const DMS_LOGO_URL = 'https://res.cloudinary.com/dj73vkht6/image/upload/v1784169860/DMS_logo_2_dusshv.jpg';
const PUBLIC_GET_ROUTES = ['ticket.signature.public.get', 'boletas.firma.publica.get'];
const PUBLIC_SUBMIT_ROUTES = ['ticket.signature.public.submit', 'boletas.firma.publica.guardar'];

function VisitContext({ reasonForVisit, testsPerformed, compact = false }) {
  return (
    <section className={`public-signature-context${compact ? ' is-compact' : ''}`} aria-label="Información del servicio">
      <article>
        <strong>Razón de la visita</strong>
        <p>{reasonForVisit || 'No registrada.'}</p>
      </article>
      <article>
        <strong>Pruebas realizadas</strong>
        <p>{testsPerformed || 'No registradas.'}</p>
      </article>
    </section>
  );
}

export default function PublicSignaturePage() {
  const { token = '' } = useParams();
  const [request, setRequest] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState(false);
  const [expired, setExpired] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    requestAvailable(PUBLIC_GET_ROUTES, { token })
      .then((data) => {
        if (!active) return;
        setRequest(data.request || null);
        setTicket(data.ticket || null);
        setSigned(Boolean(data.alreadySigned));
        setExpired(Boolean(data.expired));
      })
      .catch((loadError) => {
        if (!active) return;
        if (loadError.code === 'SIGNATURE_LINK_EXPIRED') setExpired(true);
        else setError(loadError.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function saveSignature() {
    if (!signature.startsWith('data:image/')) {
      setError('Dibuje su firma dentro del recuadro antes de guardarla.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await requestAvailable(PUBLIC_SUBMIT_ROUTES, {
        token,
        base64: signature.split(',')[1],
        mimeType: 'image/png',
      });
      setSigned(true);
      setSignature('');
      setTicket(result.ticket || ticket);
      setMessage(result.message || 'La firma fue guardada correctamente.');
    } catch (saveError) {
      if (saveError.code === 'SIGNATURE_LINK_EXPIRED') setExpired(true);
      else setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  const visits = Array.isArray(ticket?.visits) ? ticket.visits : [];
  const visitCount = Number(ticket?.visitCount || request?.visitCount || visits.length || 1);

  return (
    <main className="public-signature-page">
      <header className="public-signature-brand">
        <span><Icon name="draw" /></span>
        <div><strong>DMS Boletas</strong><small>Firma de conformidad</small></div>
      </header>

      <section className="public-signature-shell">
        {loading ? (
          <div className="public-signature-state"><Icon name="progress_activity" /><h1>Cargando boleta...</h1><p>Estamos preparando el espacio de firma.</p></div>
        ) : signed ? (
          <div className="public-signature-state public-signature-state--success">
            <img className="public-completion-logo" src={DMS_LOGO_URL} alt="Digital Management Systems" />
            <span className="eyebrow">Firma registrada</span>
            <h1>¡Muchas gracias!</h1>
            <p>{message || 'La boleta ya cuenta con su firma. El reporte firmado fue preparado para su envío.'}</p>
            {ticket?.number && <strong>{visitCount > 1 ? `Boletas #${ticket.number}` : `Boleta #${ticket.number}`}</strong>}
          </div>
        ) : expired ? (
          <div className="public-signature-state public-signature-state--warning"><Icon name="event_busy" /><h1>Enlace vencido</h1><p>Solicite al técnico un enlace nuevo para firmar la boleta.</p></div>
        ) : error && !ticket ? (
          <div className="public-signature-state public-signature-state--error"><Icon name="link_off" /><h1>No pudimos abrir la boleta</h1><p>{error}</p></div>
        ) : ticket ? (
          <>
            <div className="public-signature-heading">
              <span className="eyebrow">{ticket.clientName || request?.clientName || 'Cliente'}</span>
              <h1>{visitCount > 1 ? 'Firmar seguimiento de visitas' : 'Firmar boleta de servicio'}</h1>
              <p>{visitCount > 1 ? `Esta firma se aplicará a las ${visitCount} visitas relacionadas.` : 'Revise la información y firme dentro del recuadro.'}</p>
            </div>

            <dl className="public-signature-summary">
              <div><dt>{visitCount > 1 ? 'Boletas' : 'Boleta'}</dt><dd>#{ticket.number || '—'}</dd></div>
              <div><dt>Visitas</dt><dd>{visitCount}</dd></div>
              <div className="is-wide"><dt>Servicio</dt><dd>{ticket.title || 'Boleta de servicio'}</dd></div>
              <div className="is-wide"><dt>Ubicación principal</dt><dd>{ticket.location || 'Sin especificar'}</dd></div>
              {ticket.supervisor && <div className="is-wide"><dt>Supervisor</dt><dd>{ticket.supervisor}</dd></div>}
            </dl>

            {visitCount === 1 && (
              <VisitContext
                reasonForVisit={ticket.reasonForVisit}
                testsPerformed={ticket.testsPerformed}
              />
            )}

            {visits.length > 1 && (
              <div className="public-signature-visits">
                {visits.map((visit) => (
                  <article key={visit.uid}>
                    <strong>Visita {visit.visitNumber} · Boleta #{visit.number}</strong>
                    <span>{visit.date || 'Sin fecha'}{visit.location ? ` · ${visit.location}` : ''}</span>
                    <VisitContext
                      reasonForVisit={visit.reasonForVisit}
                      testsPerformed={visit.testsPerformed}
                      compact
                    />
                    {visit.result && <p>{visit.result}</p>}
                  </article>
                ))}
              </div>
            )}

            <div className="public-signature-instructions">
              <Icon name="info" />
              <p>Al guardar, confirma la recepción del servicio descrito. Esta página únicamente permite registrar la firma y, cuando existen visitas relacionadas, la misma firma se guarda en todas.</p>
            </div>

            <section className="public-signature-pad-card">
              <SignaturePad value={signature} onChange={setSignature} />
            </section>

            {error && <div className="public-signature-error"><Icon name="error" /><span>{error}</span></div>}

            <button className="button button--primary public-signature-save" type="button" onClick={saveSignature} disabled={!signature || saving}>
              <Icon name={saving ? 'progress_activity' : 'save'} />
              {saving ? 'Guardando firma...' : 'Guardar firma'}
            </button>
          </>
        ) : null}
      </section>

      <footer className="public-signature-footer">Digital Management Systems · Enlace exclusivo para la firma de esta boleta.</footer>
    </main>
  );
}