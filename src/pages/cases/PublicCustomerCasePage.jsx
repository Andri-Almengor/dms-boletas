import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import {
  CUSTOMER_CASE_ROUTES,
  newCustomerCaseRequestId,
  prepareCustomerCaseEvidence,
  requestCustomerCase,
} from '../../services/customerCases';
import '../../styles/customer-cases.css';

const DMS_LOGO_URL = 'https://res.cloudinary.com/dj73vkht6/image/upload/v1784169860/DMS_logo_2_dusshv.jpg';
const EMPTY_FORM = Object.freeze({ reason: '', problem: '', requesterName: '', email: '', website: '' });

function releaseEvidence(items = []) {
  items.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
}

export default function PublicCustomerCasePage() {
  const { token = '' } = useParams();
  const inputRef = useRef(null);
  const [client, setClient] = useState(null);
  const [limits, setLimits] = useState({ maxImages: 8, maxFileMb: 6, maxTotalMb: 22 });
  const [form, setForm] = useState(EMPTY_FORM);
  const [evidences, setEvidences] = useState([]);
  const [requestId, setRequestId] = useState(() => newCustomerCaseRequestId());
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    requestCustomerCase(CUSTOMER_CASE_ROUTES.publicGet, { token })
      .then((data) => {
        if (!active) return;
        setClient(data.client || null);
        setLimits(data.limits || limits);
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'No se pudo abrir el formulario.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      releaseEvidence(evidences);
    };
    // El token identifica de forma estable el portal del cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const totalBytes = useMemo(() => evidences.reduce((sum, item) => sum + Number(item.size || 0), 0), [evidences]);
  const totalMb = totalBytes / 1024 / 1024;

  function change(name) {
    return (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  }

  async function addFiles(event) {
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    if (!selected.length) return;
    setError('');
    if (evidences.length + selected.length > Number(limits.maxImages || 8)) {
      setError(`Puede adjuntar un máximo de ${limits.maxImages || 8} imágenes.`);
      return;
    }
    const invalid = selected.find((file) => !String(file.type || '').startsWith('image/'));
    if (invalid) {
      setError(`${invalid.name} no es una imagen válida.`);
      return;
    }
    const tooLarge = selected.find((file) => file.size > Number(limits.maxFileMb || 6) * 1024 * 1024);
    if (tooLarge) {
      setError(`${tooLarge.name} supera el límite de ${limits.maxFileMb || 6} MB.`);
      return;
    }
    setPreparing(true);
    try {
      const prepared = [];
      for (const file of selected) prepared.push(await prepareCustomerCaseEvidence(file));
      const nextTotal = totalBytes + prepared.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (nextTotal > Number(limits.maxTotalMb || 22) * 1024 * 1024) {
        releaseEvidence(prepared);
        setError(`Las imágenes superan el límite total de ${limits.maxTotalMb || 22} MB.`);
        return;
      }
      setEvidences((current) => [...current, ...prepared]);
    } catch (fileError) {
      setError(fileError.message || 'No se pudieron preparar las imágenes.');
    } finally {
      setPreparing(false);
    }
  }

  function removeEvidence(index) {
    setEvidences((current) => {
      const target = current[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function validate() {
    if (!form.reason.trim()) return 'Escriba la razón de la visita.';
    if (!form.problem.trim()) return 'Describa el problema que presenta.';
    if (!form.requesterName.trim()) return 'Escriba el nombre de quien genera el caso.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Escriba un correo electrónico válido.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await requestCustomerCase(CUSTOMER_CASE_ROUTES.publicSubmit, {
        token,
        requestId,
        reason: form.reason.trim(),
        problem: form.problem.trim(),
        requesterName: form.requesterName.trim(),
        email: form.email.trim(),
        website: form.website,
        evidences: evidences.map(({ previewUrl: _previewUrl, ...item }) => item),
      });
      setResult(response);
      releaseEvidence(evidences);
      setEvidences([]);
    } catch (submitError) {
      setError(submitError.message || 'No fue posible enviar el caso.');
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother() {
    setForm(EMPTY_FORM);
    setResult(null);
    setError('');
    setRequestId(newCustomerCaseRequestId());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return <main className="customer-case-public-page">
    <header className="customer-case-public-brand">
      <img src={DMS_LOGO_URL} alt="Digital Management Systems" />
      <div><strong>DMS Soporte</strong><span>Creación de casos técnicos</span></div>
    </header>

    <section className="customer-case-public-shell">
      {loading ? <div className="case-state-card"><Icon name="progress_activity" /><h1>Preparando formulario...</h1><p>Estamos validando el enlace del cliente.</p></div>
        : error && !client ? <div className="case-state-card is-error"><Icon name="link_off" /><h1>Enlace no disponible</h1><p>{error}</p></div>
          : result ? <div className="case-success-card">
            <span className="case-success-card__icon"><Icon name="task_alt" /></span>
            <span className="eyebrow">Solicitud recibida</span>
            <h1>Caso {result.caseNumber}</h1>
            <p>{result.message || 'El caso fue creado correctamente y quedó en espera de revisión.'}</p>
            <div className="case-success-card__summary">
              <span><Icon name="corporate_fare" />{client?.name}</span>
              <span><Icon name="photo_library" />{result.evidenceCount || 0} evidencia{Number(result.evidenceCount || 0) === 1 ? '' : 's'}</span>
              <span><Icon name="schedule" />En espera</span>
            </div>
            {!result.notificationSent && <div className="case-inline-warning"><Icon name="warning" /><span>El caso quedó guardado. La notificación interna será revisada por DMS.</span></div>}
            <button className="button button--primary" type="button" onClick={startAnother}><Icon name="add_circle" />Enviar otro caso</button>
          </div>
            : <>
              <div className="customer-case-public-heading">
                <span className="eyebrow">{client?.name || 'Cliente DMS'}</span>
                <h1>Reporte un caso técnico</h1>
                <p>Describa la situación y adjunte fotografías que ayuden al equipo técnico a prepararse para la visita.</p>
              </div>

              <form className="customer-case-public-form" onSubmit={submit} noValidate>
                <label className="case-field is-wide"><span>Razón de la visita *</span><input value={form.reason} onChange={change('reason')} maxLength="2000" placeholder="Ejemplo: Cámara sin visualización en recepción" autoComplete="off" /></label>
                <label className="case-field is-wide"><span>Problema que presenta *</span><textarea value={form.problem} onChange={change('problem')} maxLength="8000" rows="6" placeholder="Explique qué sucede, desde cuándo y en qué lugar se presenta." /></label>
                <label className="case-field"><span>Nombre de quien genera el caso *</span><input value={form.requesterName} onChange={change('requesterName')} maxLength="250" autoComplete="name" placeholder="Nombre completo" /></label>
                <label className="case-field"><span>Correo electrónico *</span><input value={form.email} onChange={change('email')} type="email" maxLength="320" autoComplete="email" placeholder="nombre@empresa.com" /></label>
                <label className="case-honeypot" aria-hidden="true"><span>Sitio web</span><input value={form.website} onChange={change('website')} tabIndex="-1" autoComplete="off" /></label>

                <section className="case-upload-section">
                  <div className="case-upload-section__heading"><div><strong>Evidencias fotográficas</strong><span>Opcional · máximo {limits.maxImages} imágenes · {limits.maxFileMb} MB por archivo</span></div><span>{evidences.length}/{limits.maxImages}</span></div>
                  <button type="button" className="case-upload-dropzone" onClick={() => inputRef.current?.click()} disabled={preparing || evidences.length >= limits.maxImages}>
                    <Icon name={preparing ? 'progress_activity' : 'add_photo_alternate'} />
                    <strong>{preparing ? 'Preparando imágenes...' : 'Seleccionar fotografías'}</strong>
                    <span>JPG, PNG, WEBP, GIF, HEIC o HEIF</span>
                  </button>
                  <input ref={inputRef} className="case-file-input" type="file" accept="image/*" multiple onChange={addFiles} />
                  {evidences.length > 0 && <div className="case-evidence-preview-grid">{evidences.map((item, index) => <article key={`${item.fileName}-${index}`}><img src={item.previewUrl} alt={item.fileName} /><button type="button" onClick={() => removeEvidence(index)} aria-label={`Eliminar ${item.fileName}`}><Icon name="close" /></button><span>{item.fileName}</span></article>)}</div>}
                  <small className="case-upload-total">Tamaño preparado: {totalMb.toFixed(1)} de {limits.maxTotalMb} MB</small>
                </section>

                {error && <div className="case-form-error"><Icon name="error" /><span>{error}</span></div>}
                <button className="button button--primary case-submit-button" disabled={submitting || preparing}>
                  <Icon name={submitting ? 'progress_activity' : 'send'} />{submitting ? 'Creando caso y enviando evidencias...' : 'Enviar caso'}
                </button>
                <p className="case-form-privacy"><Icon name="lock" />La información será utilizada únicamente para gestionar esta solicitud de soporte técnico.</p>
              </form>
            </>}
    </section>

    <footer className="customer-case-public-footer">Digital Management Systems · Este enlace puede utilizarse nuevamente para reportar otro caso.</footer>
  </main>;
}
