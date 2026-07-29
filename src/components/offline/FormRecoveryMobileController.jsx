import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PANEL_SELECTOR = '.form-recovery-status';
const MOBILE_QUERY = '(max-width: 620px)';

function collapse(panel) {
  if (!panel) return;
  panel.classList.remove('is-mobile-expanded');
  panel.setAttribute('aria-expanded', 'false');
}

function enhance(panel, mobile) {
  if (!panel) return;
  if (!mobile) {
    panel.removeAttribute('tabindex');
    panel.removeAttribute('aria-expanded');
    panel.removeAttribute('aria-label');
    panel.classList.remove('is-mobile-expanded');
    return;
  }

  panel.setAttribute('tabindex', '0');
  panel.setAttribute('aria-expanded', panel.classList.contains('is-mobile-expanded') ? 'true' : 'false');
  panel.setAttribute('aria-label', 'Estado del borrador. Toque para ver detalles.');
}

export default function FormRecoveryMobileController() {
  const location = useLocation();

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);

    const refresh = () => enhance(document.querySelector(PANEL_SELECTOR), media.matches);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();

    const handleClick = (event) => {
      if (!media.matches || !(event.target instanceof Element)) return;
      const panel = event.target.closest(PANEL_SELECTOR);
      const current = document.querySelector(PANEL_SELECTOR);

      if (!panel) {
        collapse(current);
        return;
      }

      if (event.target.closest(`${PANEL_SELECTOR} > button`)) return;
      panel.classList.toggle('is-mobile-expanded');
      panel.setAttribute('aria-expanded', panel.classList.contains('is-mobile-expanded') ? 'true' : 'false');
    };

    const handleKeyDown = (event) => {
      if (!media.matches || !(event.target instanceof Element)) return;
      const panel = event.target.closest(PANEL_SELECTOR);
      if (!panel || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      panel.classList.toggle('is-mobile-expanded');
      panel.setAttribute('aria-expanded', panel.classList.contains('is-mobile-expanded') ? 'true' : 'false');
    };

    const handleMediaChange = () => refresh();
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    media.addEventListener?.('change', handleMediaChange);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      media.removeEventListener?.('change', handleMediaChange);
    };
  }, [location.pathname, location.search]);

  return null;
}
