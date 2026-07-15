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

  const total = formatCeilingTotalHours(startInput.value, endInput.value);
  setReactInputValue(totalInput, total);
}

/**
 * Mantiene la lógica de horas consistente en la edición completa y rápida.
 * Se usa como puente porque ambos formularios ya son controlados por React y
 * cualquier cambio debe disparar el evento input para actualizar su estado.
 */
export default function TicketHoursCeilingBridge() {
  useEffect(() => {
    let timeoutId = 0;

    const scheduleSync = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(syncVisibleTicketForm, 60);
    };

    const handleInput = (event) => {
      if (event.target?.matches?.(`${START_SELECTOR}, ${END_SELECTOR}`)) {
        scheduleSync();
      }
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', handleInput, true);

    // Respaldo para asegurar que el cálculo automático local de las pantallas
    // no vuelva a colocar horas decimales después del cambio de horario.
    const intervalId = window.setInterval(syncVisibleTicketForm, 500);
    scheduleSync();

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      observer.disconnect();
      document.removeEventListener('input', handleInput, true);
    };
  }, []);

  return null;
}
