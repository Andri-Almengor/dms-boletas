import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ProcessingOverlay from './ProcessingOverlay';

const DEFAULT_DETAIL = 'No cierre ni recargue esta pantalla mientras se completa la operación.';

function cleanText(element) {
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function operationFor(pathname) {
  if (/^\/boletas\/[^/]+\/?$/.test(pathname)) {
    return {
      selector: '.ticket-detail-actions button',
      activeText: /Procesando(?:\.\.\.|…)?/i,
      copy: () => ({
        title: 'Finalizando boleta',
        message: 'Estamos generando el PDF y enviando las notificaciones configuradas.',
        detail: 'Este proceso puede tardar unos segundos. No cierre ni recargue la pantalla.',
      }),
    };
  }

  if (/^\/firmar\/[^/]+\/?$/.test(pathname)) {
    return {
      selector: '.public-signature-save',
      activeText: /Guardando firma|Comprobando firma/i,
      copy: (buttonText) => buttonText.toLowerCase().includes('comprobando')
        ? {
          title: 'Comprobando firma',
          message: 'Estamos verificando el formulario de firma.',
          detail: DEFAULT_DETAIL,
        }
        : {
          title: 'Guardando firma',
          message: 'Estamos registrando la firma y preparando la confirmación.',
          detail: 'No cierre ni recargue esta pantalla mientras se registra la firma.',
        },
    };
  }

  if (/^\/encuesta\/[^/]+\/?$/.test(pathname)) {
    return {
      selector: '.public-survey-actions button',
      activeText: /Enviando(?:\.\.\.|…)?/i,
      copy: () => ({
        title: 'Enviando encuesta',
        message: 'Estamos registrando sus respuestas de satisfacción.',
        detail: 'No cierre ni recargue esta pantalla hasta recibir la confirmación.',
      }),
    };
  }

  return null;
}

export default function ActionProcessingBridge() {
  const { pathname } = useLocation();
  const [overlay, setOverlay] = useState(null);

  useEffect(() => {
    const operation = operationFor(pathname);
    setOverlay(null);
    if (!operation || typeof document === 'undefined') return undefined;

    let animationFrame = 0;
    const sync = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const activeButton = Array.from(document.querySelectorAll(operation.selector))
          .find((button) => button.disabled && operation.activeText.test(cleanText(button)));
        setOverlay(activeButton ? operation.copy(cleanText(activeButton)) : null);
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    document.addEventListener('click', sync, true);
    sync();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('click', sync, true);
    };
  }, [pathname]);

  return (
    <ProcessingOverlay
      open={Boolean(overlay)}
      title={overlay?.title}
      message={overlay?.message}
      detail={overlay?.detail}
    />
  );
}
