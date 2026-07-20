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
  const [subject, setSubject] = useState(null);
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState(false);
  const [expired, setExpired] = useState(false);
  const [testMode, setTestMode] = useState(false);
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
        setSubject(data.maintenance || data.ticket || null);
        setSigned(Boolean(data.alreadySigned));
        setExpired(Boolean(data.expired));
        setTestMode(Boolean(data.testMode || data.request?.testMode));
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
      setSubject(result.maintenance || result.ticket || subject);
      setTestMode(Boolean(result.testMode || request?.testMode));
      setMessage(result.message || 'La firma fue guardada correctamente.');
    } catch (saveError) {
      if (saveError.code === 'SIGNATURE_LINK_EXPIRED') setExpired(true);
      else setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  const isMaintenance = subject?.subjectType === 'maintenance'
    || request?.subjectType === 'maintenance';
  const visits = Array.isArray(subject?.visits) ? subject.visits : [];
  const visitCount = Number(subject?.visitCount || request?.visitCount || visits.length || 1);
  const categories = Array.isArray(subject?.categories) ? subject.categories : [];

  const signedTitle = testMode
    ? '¡Prueba completada!'
    : isMaintenance
      ? '¡Mantenimiento firmado!'
      : '¡Muchas gracias!';
  const signedMessage = message || (testMode
    ? 'La prueba funcionó correctamente. No se guardó ninguna firma real ni se modificaron registros.'
    : isMaintenance
      ? 'La firma general fue registrada y se aplicará a todas las boletas automáticas de este mantenimiento.'
      : 'La boleta ya cuenta con su firma. El reporte firmado fue preparado para su envío.');

  return (
    <main className="public-signature-page">
      <header className="public-signature-brand">
        <span><Icon name={testMode ? 'science' : 'draw'} /></span>
        <div>
          <strong>DMS Boletas</strong>
          <small>{testMode ? 'Prueba de firma' : 'Firma de conformidad'}</small>
        </div>
      </header>

      <section className="public-signature-shell">
        {loading ? (
          <div className="public-signature-state"><Icon name="progress_activity" /><h1>Cargando información...</h1><p>Estamos preparando el espacio de firma.</p></div>
        ) : signed ? (
          <div className="public-signature-state public-signature-state--success">
            <img className="public-completion-logo" src={DMS_LOGO_URL} alt="Digital Management Systems" />
            <span className="eyebrow">{testMode ? 'Modo de prueba' : 'Firma registrada'}</span>
            <h1>{signedTitle}</h1>
            <p>{signedMessage}</p>
            {!testMode && isMaintenance && subject?.title && <strong>{subject.title}</strong>}
            {!testMode && !isMaintenance && subject?.number && <strong>{visitCount > 1 ? `Boletas #${subject.number}` : `Boleta #${subject.number}`}</strong>}
          </div>
        ) : expired ? (
          <div className="public-signature-state public-signature-state--warning"><Icon name="event_busy" /><h1>Enlace vencido</h1><p>Solicite al técnico un enlace nuevo para registrar la firma.</p></div>
        ) : error && !subject ? (
          <div className="public-signature-state public-signature-state--error"><Icon name="link_off" /><h1>No pudimos abrir el enlace</h1><p>{error}</p></div>
        ) : subject ? (
          <>
            {testMode && (
              <div className="alert alert--warning">
                <Icon name="science" />
                <span>Esta es una prueba administrativa. Puede dibujar y guardar una firma, pero no se almacenará en el mantenimiento ni se copiará a ninguna boleta.</span>
              </div>
            )}

            <div className="public-signature-heading">
              <span className="eyebrow">{subject.clientName || request?.clientName || 'Cliente'}</span>
              <h1>{isMaintenance
                ? testMode ? 'Probar firma del mantenimiento' : 'Firmar mantenimiento general'
                : visitCount > 1 ? 'Firmar seguimiento de visitas' : 'Firmar boleta de servicio'}</h1>
              <p>{isMaintenance
                ? 'Esta firma corresponde al mantenimiento completo y se utilizará en todas las boletas automáticas que se generen. No es una firma individual por dispositivo.'
                : visitCount > 1
                  ? `Esta firma se aplicará a las ${visitCount} visitas relacionadas.`
                  : 'Revise la información y firme dentro del recuadro.'}</p>
            </div>

            {isMaintenance ? (
              <>
                <dl className="public-signature-summary">
                  <div className="is-wide"><dt>Mantenimiento</dt><dd>{subject.title || 'Mantenimiento técnico'}</dd></div>
                  <div><dt>Fecha</dt><dd>{subject.date || 'Sin especificar'}</dd></div>
                  <div><dt>Dispositivos revisados</dt><dd>{Number(subject.deviceCount || 0)}</dd></div>
                  <div className="is-wide"><dt>Ubicación</dt><dd>{subject.location || 'Sin especificar'}</dd></div>
                  {subject.supervisor && <div className="is-wide"><dt>Responsables</dt><dd>{subject.supervisor}</dd></div>}
                  {categories.length > 0 && <div className="is-wide"><dt>Categorías atendidas</dt><dd>{categories.join(', ')}</dd></div>}
                </dl>
                <section className="public-signature-context" aria-label="Descripción del mantenimiento">
                  <article>
                    <strong>Descripción general del mantenimiento</strong>
                    <p>{subject.description || 'Mantenimiento preventivo y revisión técnica de los dispositivos registrados.'}</p>
                  </article>
                </section>
              </>
            ) : (
              <>
                <dl className="public-signature-summary">
                  <div><dt>{visitCount > 1 ? 'Boletas' : 'Boleta'}</dt><dd>#{subject.number || '—'}</dd></div>
                  <div><dt>Visitas</dt><dd>{visitCount}</dd></div>
                  <div className="is-wide"><dt>Servicio</dt><dd>{subject.title || 'Boleta de servicio'}</dd></div>
                  <div className="is-wide"><dt>Ubicación principal</dt><dd>{subject.location || 'Sin especificar'}</dd></div>
                  {subject.supervisor && <div className="is-wide"><dt>Supervisor</dt><dd>{subject.supervisor}</dd></div>}
                </dl>

                {visitCount === 1 && (
                  <VisitContext
                    reasonForVisit={subject.reasonForVisit}
                    testsPerformed={subject.testsPerformed}
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
              </>
            )}

            <div className="public-signature-instructions">
              <Icon name="info" />
              <p>{testMode
                ? 'Al guardar se comprobará el funcionamiento del formulario, pero la imagen no se almacenará ni modificará registros reales.'
                : isMaintenance
                  ? 'Al guardar, confirma la conformidad con el mantenimiento general descrito. La misma firma se incorporará en todas las boletas automáticas relacionadas con este mantenimiento.'
                  : 'Al guardar, confirma la recepción del servicio descrito. Esta página únicamente permite registrar la firma y, cuando existen visitas relacionadas, la misma firma se guarda en todas.'}</p>
            </div>

            <section className="public-signature-pad-card">
              <SignaturePad value={signature} onChange={setSignature} />
            </section>

            {error && <div className="public-signature-error"><Icon name="error" /><span>{error}</span></div>}

            <button className="button button--primary public-signature-save" type="button" onClick={saveSignature} disabled={!signature || saving}>
              <Icon name={saving ? 'progress_activity' : testMode ? 'science' : 'save'} />
              {saving
                ? testMode ? 'Comprobando firma...' : 'Guardando firma...'
                : testMode ? 'Completar prueba de firma' : 'Guardar firma'}
            </button>
          </>
        ) : null}
      </section>

      <footer className="public-signature-footer">Digital Management Systems · {testMode ? 'Prueba administrativa aislada.' : isMaintenance ? 'Enlace exclusivo para la firma general del mantenimiento.' : 'Enlace exclusivo para la firma de esta boleta.'}</footer>
    </main>
  );
}
