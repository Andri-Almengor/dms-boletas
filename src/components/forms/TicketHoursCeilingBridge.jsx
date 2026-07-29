import { useEffect } from 'react';
import { formatCeilingTotalHours } from '../../utils/ticketHours';

const START_SELECTOR = 'input[name="horaInicio"]';
const END_SELECTOR = 'input[name="horaFinal"]';
const TOTAL_SELECTOR = 'input[name="horasTotales"]';

function setReactInputValue(input, value) {
  if (!input || input.value === value) return;

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncVisibleTicketForm() {
  const startInput = document.querySelector(START_SELECTOR);
  const endInput = document.querySelector(END_SELECTOR);
  const totalInput = document.querySelector(TOTAL_SELECTOR);

  if (!startInput || !endInput || !totalInput) return;

  totalInput.readOnly = true;
  totalInput.setAttribute('aria-readonly', 'true');
  totalInput.title = 'Se calcula automáticamente: mínimo 1 hora; después de la primera hora conserva el tiempo real.';

  const total = formatCeilingTotalHours(startInput.value, endInput.value);
  setReactInputValue(totalInput, total);
}

/**
 * Se monta únicamente en las rutas de boletas que tienen campos de tiempo.
 * Reacciona a cambios reales del formulario y a la aparición de nuevos pasos,
 * sin mantener un intervalo permanente en el hilo principal.
 */
export default function TicketHoursCeilingBridge() {
  useEffect(() => {
    let timeoutId = 0;

    const scheduleSync = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(syncVisibleTicketForm, 60);
    };

    const handleInput = (event) => {
      if (event.target?.matches?.(`${START_SELECTOR}, ${END_SELECTOR}`)) scheduleSync();
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) scheduleSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleInput, true);
    scheduleSync();

    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleInput, true);
    };
  }, []);

  return null;
}
