import React, { useEffect, useState } from 'react';
import Icon from '../common/Icon';
import {
  CUSTOMER_CASE_ROUTES,
  requestCustomerCase,
} from '../../services/customerCases';
import '../../styles/customer-cases.css';
import '../../styles/customer-cases-workflow.css';

async function copyText(value) {
  if (!value) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

function PortalLink({ label, description, url, testMode, onMessage, onError }) {
  async function copy() {
    try {
      await copyText(url);
      onMessage(testMode ? 'Enlace de prueba copiado.' : 'Enlace real copiado al portapapeles.');
      onError('');
    } catch {
      onError('No se pudo copiar automáticamente. Seleccione el enlace y cópielo manualmente.');
    }
  }

  return <div className={`client-case-portal-card__link-group${testMode ? ' is-test' : ''}`}>
    <div className="client-case-portal-card__link-label">
      <span><Icon name={testMode ? 'science' : 'support_agent'} />{label}</span>
      {testMode && <small>PRUEBA SEGURA</small>}
    </div>
    <p>{description}</p>
    <div className="client-case-portal-card__url">
      <input value={url || ''} readOnly aria-label={label} />
      <button className="icon-button icon-button--outlined" type="button" onClick={copy} title="Copiar enlace"><Icon name="content_copy" /></button>
    </div>
    <a className="button button--secondary button--compact" href={url} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Abrir {testMode ? 'prueba' : 'formulario'}</a>
  </div>;
}

export default function ClientCasePortalCard({ clientId, clientName, sessionToken }) {
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const result = await requestCustomerCase(CUSTOMER_CASE_ROUTES.clientLinkGet, { clientId }, sessionToken);
      setPortal(result);
    } catch (loadError) {
      setError(loadError.message || 'No se pudo consultar el enlace del cliente.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [clientId, sessionToken]);

  async function createOrRotate(rotate = false) {
    if (rotate && !window.confirm(`¿Reemplazar los enlaces de ${clientName}? Los enlaces real y de prueba anteriores dejarán de funcionar de inmediato.`)) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await requestCustomerCase(CUSTOMER_CASE_ROUTES.clientLinkCreate, { clientId, rotate }, sessionToken);
      setPortal({ ...result, configured: true });
      setMessage(rotate ? 'Se generaron enlaces nuevos. Los anteriores fueron revocados.' : 'Los enlaces real y de prueba se generaron correctamente.');
    } catch (actionError) {
      setError(actionError.message || 'No se pudieron generar los enlaces.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!portal?.configured || busy) return;
    const active = !portal.active;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await requestCustomerCase(CUSTOMER_CASE_ROUTES.clientLinkUpdate, { clientId, active }, sessionToken);
      setPortal((current) => ({ ...current, ...result }));
      setMessage(active ? 'Los formularios real y de prueba volvieron a estar disponibles.' : 'Los enlaces fueron pausados. Puede reactivarlos sin cambiar las URL.');
    } catch (actionError) {
      setError(actionError.message || 'No se pudo cambiar el estado de los enlaces.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="client-case-portal-card">
    <header><span><Icon name="link" /></span><div><strong>Formularios reutilizables de casos</strong><small>El enlace real recibe casos operativos. El enlace de prueba permite validar correos y boletas sin afectar el consecutivo.</small></div></header>

    {loading
      ? <p className="client-case-portal-card__message"><Icon name="progress_activity" /> Consultando enlaces...</p>
      : portal?.configured ? <>
        <div className="client-case-portal-card__links">
          <PortalLink label="Enlace real del cliente" description="Notifica a coordinación, crea casos CAS y genera boletas con el consecutivo normal." url={portal.url} onMessage={setMessage} onError={setError} />
          {portal.testUrl && <PortalLink label="Enlace exclusivo de prueba" description="El caso inicial se envía solo a Andrick. La boleta usa PRUEBA y no consume el consecutivo real. Los técnicos seleccionados sí reciben el correo." url={portal.testUrl} testMode onMessage={setMessage} onError={setError} />}
        </div>
        <div className="client-case-portal-card__actions">
          <button className="button button--secondary button--compact" type="button" onClick={toggle} disabled={busy}><Icon name={portal.active ? 'pause_circle' : 'play_circle'} />{portal.active ? 'Pausar enlaces' : 'Reactivar enlaces'}</button>
          <button className="button button--ghost button--compact" type="button" onClick={() => createOrRotate(true)} disabled={busy}><Icon name={busy ? 'progress_activity' : 'refresh'} />Generar otros</button>
        </div>
        <span className={`status-chip ${portal.active ? 'status-chip--active' : 'status-chip--neutral'}`}>{portal.active ? 'FORMULARIOS ACTIVOS' : 'FORMULARIOS PAUSADOS'}</span>
      </> : <button className="button button--primary" type="button" onClick={() => createOrRotate(false)} disabled={busy}><Icon name={busy ? 'progress_activity' : 'add_link'} />{busy ? 'Generando...' : 'Generar enlaces del cliente'}</button>}

    {(message || error) && <p className={`client-case-portal-card__message${error ? ' is-error' : ''}`}>{error || message}</p>}
  </section>;
}
