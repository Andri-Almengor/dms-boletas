import React, { useEffect, useState } from 'react';
import Icon from '../common/Icon';
import {
  CUSTOMER_CASE_ROUTES,
  requestCustomerCase,
} from '../../services/customerCases';
import '../../styles/customer-cases.css';

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
    if (rotate && !window.confirm(`¿Reemplazar el enlace de ${clientName}? El enlace anterior dejará de funcionar de inmediato.`)) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await requestCustomerCase(CUSTOMER_CASE_ROUTES.clientLinkCreate, { clientId, rotate }, sessionToken);
      setPortal({ ...result, configured: true });
      setMessage(rotate ? 'Se generó un enlace nuevo. El anterior fue revocado.' : 'Enlace reutilizable generado correctamente.');
    } catch (actionError) {
      setError(actionError.message || 'No se pudo generar el enlace.');
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
      setMessage(active ? 'El formulario volvió a estar disponible.' : 'El enlace fue pausado. Puede reactivarlo sin cambiar la URL.');
    } catch (actionError) {
      setError(actionError.message || 'No se pudo cambiar el estado del enlace.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!portal?.url) return;
    try {
      await navigator.clipboard.writeText(portal.url);
      setMessage('Enlace copiado al portapapeles.');
      setError('');
    } catch {
      setError('No se pudo copiar automáticamente. Seleccione el enlace y cópielo manualmente.');
    }
  }

  return <section className="client-case-portal-card">
    <header><span><Icon name="link" /></span><div><strong>Formulario reutilizable de casos</strong><small>Este enlace identifica al cliente y permite crear todas las solicitudes que necesite.</small></div></header>
    {loading ? <p className="client-case-portal-card__message"><Icon name="progress_activity" /> Consultando enlace...</p>
      : portal?.configured ? <>
        <div className="client-case-portal-card__url"><input value={portal.url || ''} readOnly aria-label="Enlace reutilizable del cliente" /><button className="icon-button icon-button--outlined" type="button" onClick={copy} title="Copiar enlace"><Icon name="content_copy" /></button></div>
        <div className="client-case-portal-card__actions">
          <a className="button button--secondary button--compact" href={portal.url} target="_blank" rel="noreferrer"><Icon name="open_in_new" />Abrir</a>
          <button className="button button--secondary button--compact" type="button" onClick={toggle} disabled={busy}><Icon name={portal.active ? 'pause_circle' : 'play_circle'} />{portal.active ? 'Pausar enlace' : 'Reactivar enlace'}</button>
          <button className="button button--ghost button--compact" type="button" onClick={() => createOrRotate(true)} disabled={busy}><Icon name="refresh" />Generar otro</button>
        </div>
        <span className={`status-chip ${portal.active ? 'status-chip--active' : 'status-chip--neutral'}`}>{portal.active ? 'FORMULARIO ACTIVO' : 'FORMULARIO PAUSADO'}</span>
      </> : <button className="button button--primary" type="button" onClick={() => createOrRotate(false)} disabled={busy}><Icon name={busy ? 'progress_activity' : 'add_link'} />{busy ? 'Generando...' : 'Generar enlace del cliente'}</button>}
    {(message || error) && <p className={`client-case-portal-card__message${error ? ' is-error' : ''}`}>{error || message}</p>}
  </section>;
}
