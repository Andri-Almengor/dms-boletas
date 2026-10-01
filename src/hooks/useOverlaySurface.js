import { useEffect, useRef } from 'react';

let scrollLockDepth = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (scrollLockDepth === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockDepth += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined' || scrollLockDepth <= 0) return;
  scrollLockDepth -= 1;
  if (scrollLockDepth === 0) {
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = '';
  }
}

/**
 * Comportamiento compartido para overlays ya existentes.
 * Centraliza bloqueo de scroll, Escape y devolución del foco sin imponer
 * presentación ni reglas de negocio a modales, drawers o navegación.
 */
export default function useOverlaySurface({
  open,
  onClose,
  busy = false,
  closeOnEscape = true,
  restoreFocus = true,
}) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    lockBodyScroll();

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !closeOnEscape || busyRef.current) return;
      event.preventDefault();
      closeRef.current?.();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();

      if (!restoreFocus) return;
      const previous = previousFocusRef.current;
      if (!previous || !document.contains(previous)) return;
      window.requestAnimationFrame(() => previous.focus({ preventScroll: true }));
    };
  }, [open, closeOnEscape, restoreFocus]);
}
