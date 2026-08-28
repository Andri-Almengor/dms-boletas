import React, { useEffect, useState } from 'react';
import Icon from '../common/Icon';
import SignaturePad from '../tickets/SignaturePad';
import { requestAvailable } from '../../services/moduleApi';

const SIGNATURE_LINK_ROUTES = [
  'maintenance.signature.link',
  'mantenimientos.firma.enlace',
];
const SIGNATURE_TEST_LINK_ROUTES = [
  'maintenance.signature.test.link',
  'mantenimientos.firma.prueba.enlace',
];
const SIGNATURE_SUBMIT_ROUTES = [
  'maintenance.signature.public.submit',
  'mantenimientos.firma.publica.guardar',
];

export default function MaintenanceSignatureCard({
  maintenanceId,
  sessionToken,
  isAdmin = false,
  disabled = false,
  onStatusChange,
}) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [savingDirect, setSavingDirect] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(
        SIGNATURE_LINK_ROUTES,
        { maintenanceId, MantenimientoID: maintenanceId },
        sessionToken,
      );
      setInfo(data);
      onStatusChange?.(Boolean(data?.signed || data?.request?.status === 'FIRMADA'));
    } catch (loadError) {
      setError(loadError.message || 'No se pudo preparar el enlace de firma.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    requestAvailable(
      SIGNATURE_LINK_ROUTES,
      { maintenanceId, MantenimientoID: maintenanceId },
      sessionToken,
    )
      .then((data) => {
        if (!active) return;
        setInfo(data);
        onStatusChange?.(Boolean(data?.signed || data?.request?.status === 'FIRMADA'));
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'No se pudo preparar el enlace de firma.');
      })
      .finally(() => { if (active) setLoading(false); });

    const refresh = () => { if (active) load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('dms-offline-sync-complete', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('dms-offline-sync-complete', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceId, sessionToken]);

  const request = info?.request || null;
  const signed = Boolean(info?.signed || request?.status === 'FIRMADA');
  const url = request?.url || '';

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
          title: 'Firma del mantenimiento general',
          text: 'Abra este enlace para firmar el mantenimiento general realizado por DMS. La firma se aplicará a todas las boletas automáticas relacionadas.',
          url,
        });
      } else {
        await copyLink();
      }
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') {
        setNotice('No se pudo compartir. Use el botón Copiar enlace.');
      }
    }
  }

  async function saveDirectSignature() {
    if (savingDirect || disabled) return;
    if (!request?.token) {
      setError('No hay una solicitud de firma activa para este mantenimiento. Actualice la pantalla e inténtelo nuevamente.');
      return;
    }
    if (!signatureDraft?.startsWith('data:image/')) {
      setError('Dibuje la firma o cargue una imagen antes de guardarla.');
      return;
    }

    const base64 = String(signatureDraft).split(',')[1] || '';
    if (!base64) {
      setError('No se pudo preparar la firma seleccionada.');
      return;
    }

    setSavingDirect(true);
    setError('');
    setNotice('');
    try {
      const result = await requestAvailable(
        SIGNATURE_SUBMIT_ROUTES,
        {
          token: request.token,
          base64,
          mimeType: 'image/png',
        },
        sessionToken,
      );
      setSignatureDraft('');
      await load();
      setNotice(result?.message || 'La firma general fue guardada correctamente y se aplicará a las boletas del mantenimiento.');
      onStatusChange?.(true);
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la firma del mantenimiento.');
    } finally {
      setSavingDirect(false);
    }
  }

  async function openTestLink() {
    const testWindow = window.open('about:blank', '_blank');
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const data = await requestAvailable(
        SIGNATURE_TEST_LINK_ROUTES,
        { maintenanceId, MantenimientoID: maintenanceId },
        sessionToken,
      );
      const testUrl = data?.request?.url || '';
      if (!testUrl) throw new Error('El servidor no devolvió el enlace de prueba.');
      if (testWindow) testWindow.location.replace(testUrl);
      else window.open(testUrl, '_blank', 'noopener,noreferrer');
      setNotice('Se abrió una prueba aislada. La firma de prueba no modifica el mantenimiento ni las boletas.');
    } catch (testError) {
      try { testWindow?.close(); } catch { /* sin acción */ }
      setError(testError.message || 'No se pudo preparar la prueba de firma.');
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <section className="ticket-public-signature-card" aria-label="Firma general del mantenimiento">
        <div className="ticket-public-signature-card__heading">
          <Icon name="progress_activity" />
          <div><strong>Preparando firma general</strong><span>Espere un momento...</span></div>
        </div>
      </section>
    );
  }

  return (
    <section className={`ticket-public-signature-card${signed ? ' ticket-public-signature-card--signed' : ''}`} aria-label="Firma general del mantenimiento">
      <div className="ticket-public-signature-card__heading">
        <Icon name={signed ? 'verified' : 'draw'} filled={signed} />
        <div>
          <strong>{signed ? 'Firma general del cliente registrada' : 'Firma general del mantenimiento'}</strong>
          <span>{signed
            ? 'Esta firma se copiará automáticamente a todas las boletas generadas desde este mantenimiento.'
            : 'Puede compartir el enlace con el cliente o registrar aquí una firma dibujada o una imagen existente. Se usa una sola firma para todo el mantenimiento.'}</span>
        </div>
      </div>

      {!signed && url && (
        <>
          <input
            className="ticket-public-signature-card__link"
            value={url}
            readOnly
            aria-label="Enlace público para firmar el mantenimiento"
            onFocus={(event) => event.target.select()}
          />
          <div className="ticket-public-signature-card__actions">
            <button className="button button--secondary button--compact" type="button" onClick={copyLink} disabled={disabled || savingDirect}>
              <Icon name="content_copy" /> Copiar enlace
            </button>
            <button className="button button--primary button--compact" type="button" onClick={shareLink} disabled={disabled || savingDirect}>
              <Icon name="share" /> Compartir con cliente
            </button>
            <a className="button button--ghost button--compact" href={url} target="_blank" rel="noreferrer">
              <Icon name="open_in_new" /> Abrir enlace real
            </a>
          </div>

          <div className="maintenance-direct-signature">
            <div className="maintenance-direct-signature__heading">
              <Icon name="add_photo_alternate" />
              <div>
                <strong>Registrar firma desde este dispositivo</strong>
                <span>Dibuje la firma o use “Cargar imagen” para seleccionar una foto, captura o archivo de la firma del cliente.</span>
              </div>
            </div>
            <SignaturePad value={signatureDraft} onChange={setSignatureDraft} />
            <div className="ticket-public-signature-card__actions">
              <button
                className="button button--primary button--compact"
                type="button"
                onClick={saveDirectSignature}
                disabled={disabled || savingDirect || !signatureDraft}
              >
                <Icon name={savingDirect ? 'progress_activity' : 'verified'} />
                {savingDirect ? 'Guardando firma...' : 'Usar esta firma'}
              </button>
            </div>
            <small className="field-hint">Al guardar, esta imagen se convierte en la firma general del mantenimiento y se sincroniza con las boletas automáticas relacionadas, igual que una firma realizada desde el enlace.</small>
          </div>
        </>
      )}

      {isAdmin && (
        <div className="ticket-public-signature-card__actions">
          <button className="button button--secondary button--compact" type="button" onClick={openTestLink} disabled={disabled || testing || savingDirect}>
            <Icon name={testing ? 'progress_activity' : 'science'} />
            {testing ? 'Preparando prueba...' : 'Probar firma sin guardar'}
          </button>
        </div>
      )}

      {!signed && <small className="field-hint">Para finalizar el mantenimiento y generar las boletas automáticas, primero debe registrarse esta firma general.</small>}
      {error && <div className="public-signature-error"><Icon name="error" /><span>{error}</span></div>}
      {notice && <small className="field-hint">{notice}</small>}
    </section>
  );
}
