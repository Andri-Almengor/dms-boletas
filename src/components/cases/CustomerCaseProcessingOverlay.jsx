import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';

const DEFAULT_STEPS = Object.freeze([
  'Validando la información',
  'Guardando el caso',
  'Procesando evidencias',
  'Preparando notificaciones',
]);

export default function CustomerCaseProcessingOverlay({
  open,
  title = 'Procesando solicitud',
  message = 'Por favor, espere. No cierre esta pantalla.',
  steps = DEFAULT_STEPS,
  testMode = false,
}) {
  const normalizedSteps = useMemo(
    () => (Array.isArray(steps) && steps.length ? steps : DEFAULT_STEPS),
    [steps],
  );
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, normalizedSteps.length - 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [open, normalizedSteps.length]);

  if (!open) return null;

  return <div className="customer-case-processing" role="status" aria-live="polite" aria-busy="true">
    <div className="customer-case-processing__backdrop" />
    <section className="customer-case-processing__card">
      <span className={`customer-case-processing__icon${testMode ? ' is-test' : ''}`}>
        <Icon name={testMode ? 'science' : 'support_agent'} />
      </span>
      {testMode && <span className="customer-case-processing__mode">Modo de prueba</span>}
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="customer-case-processing__spinner" aria-hidden="true"><span /></div>
      <ol className="customer-case-processing__steps">
        {normalizedSteps.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-active' : ''}>
          <Icon name={index < step ? 'check_circle' : index === step ? 'progress_activity' : 'radio_button_unchecked'} />
          <span>{label}</span>
        </li>)}
      </ol>
    </section>
  </div>;
}
