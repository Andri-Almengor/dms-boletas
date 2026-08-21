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
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function applyInfo(data) {
    setInfo(data);
    onStatusChange?.(Boolean(data?.signed || data?.request?.status === 'FIRMADA'));
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await requestAvailable(
        SIGNATURE_LINK_ROUTES,
        { maintenanceId, MantenimientoID: maintenanceId },
        sessionToken,
      );
      applyInfo(data);
    } catch (loadError) {
      setError(loadError.message || 'No se pudo consultar la firma del mantenimiento.');
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
        applyInfo(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'No se pudo consultar la firma del mantenimiento.');
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
  const signature = info?.signature || {};
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

  async function saveReplacement() {
    if (!signatureDraft?.startsWith('data:image/')) {
      setError('Dibuje la nueva firma antes de guardarla.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await requestAvailable(
        SIGNATURE_LINK_ROUTES,
        {
          maintenanceId,
          MantenimientoID: maintenanceId,
          base64: signatureDraft.split(',')[1],
          mimeType: 'image/png',
          replaceSignature: true,
        },
        sessionToken,
      );
      applyInfo(data);
      setSignatureDraft('');
      setEditing(false);
      setNotice(data?.message || 'Firma del mantenimiento actualizada correctamente.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo actualizar la firma del mantenimiento.');
    } finally {
      setSaving(false);
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
          <div><strong>Consultando firma general</strong><span>Espere un momento...</span></div>
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
            ? 'Esta es la firma actualmente asociada al mantenimiento y a sus boletas automáticas.'
            : 'El cliente firma una sola vez el mantenimiento completo. No se firma cada dispositivo por separado.'}</span>
        </div>
      </div>

      {signed && !editing && (
        <div className="maintenance-signature-current">
          {signature.dataUrl ? (
            <div className="signature-display">
              <img src={signature.dataUrl} alt="Firma actual del mantenimiento" />
            </div>
          ) : (
            <div className="info-box">
              <Icon name="verified" />
              <p>La firma está registrada{signature.mediaError ? ', pero no fue posible cargar su vista previa.' : '.'}</p>
            </div>
          )}
          {signature.url && (
            <a className="button button--ghost button--compact" href={signature.url} target="_blank" rel="noreferrer">
              <Icon name="open_in_new" /> Abrir archivo de firma
            </a>
          )}
          {isAdmin && (
            <div className="ticket-public-signature-card__actions">
              <button
                className="button button--secondary button--compact"
                type="button"
                onClick={() => { setSignatureDraft(''); setEditing(true); setError(''); setNotice(''); }}
                disabled={disabled || saving}
              >
                <Icon name="edit" /> Editar / reemplazar firma
              </button>
            </div>
          )}
        </div>
      )}

      {signed && editing && (
        <div className="ticket-signature-editor">
          <div className="info-box">
            <Icon name="info" />
            <p>La nueva firma reemplazará la firma general del mantenimiento y se sincronizará con las boletas automáticas relacionadas.</p>
          </div>
          <SignaturePad value={signatureDraft} onChange={setSignatureDraft} />
          <div className="ticket-signature-editor__actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={saving}
              onClick={() => { setSignatureDraft(''); setEditing(false); }}
            >
              <Icon name="close" /> Cancelar
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={saving || !signatureDraft}
              onClick={saveReplacement}
            >
              <Icon name={saving ? 'progress_activity' : 'save'} />
              {saving ? 'Guardando...' : 'Guardar nueva firma'}
            </button>
          </div>
        </div>
      )}

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
            <button className="button button--secondary button--compact" type="button" onClick={copyLink} disabled={disabled}>
              <Icon name="content_copy" /> Copiar enlace
            </button>
            <button className="button button--primary button--compact" type="button" onClick={shareLink} disabled={disabled}>
              <Icon name="share" /> Compartir con cliente
            </button>
            <a className="button button--ghost button--compact" href={url} target="_blank" rel="noreferrer">
              <Icon name="open_in_new" /> Abrir enlace real
            </a>
          </div>
        </>
      )}

      {isAdmin && !editing && (
        <div className="ticket-public-signature-card__actions">
          <button className="button button--secondary button--compact" type="button" onClick={openTestLink} disabled={disabled || testing}>
            <Icon name={testing ? 'progress_activity' : 'science'} />
            {testing ? 'Preparando prueba...' : 'Probar firma sin guardar'}
          </button>
        </div>
      )}

      {!signed && <small className="field-hint">La firma es opcional. Si se registra, se aplicará a las boletas automáticas relacionadas.</small>}
      {error && <div className="public-signature-error"><Icon name="error" /><span>{error}</span></div>}
      {notice && <small className="field-hint">{notice}</small>}
    </section>
  );
}
