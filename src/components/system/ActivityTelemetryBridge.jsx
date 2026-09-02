import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { sendActivityEvent } from '../../services/activityReportApi';

const TICK_MS = 5 * 1000;
const FLUSH_MS = 60 * 1000;
const PAGE_VIEW_DELAY_MS = 250;
const ACTIVITY_FLUSH_EVENT = 'dms:activity-flush';

function sectionForPath(value = '') {
  const path = String(value || '').toLowerCase();
  if (!path || path === '/') return 'INICIO';
  if (path.includes('/agenda')) return 'AGENDA';
  if (path.includes('/mantenimientos')) return 'MANTENIMIENTOS';
  if (path.includes('/boletas')) return 'BOLETAS';
  if (path.includes('/casos')) return 'CASOS';
  if (path.includes('/credenciales')) return 'CREDENCIALES';
  if (path.includes('/clientes')) return 'CLIENTES';
  if (path.includes('/catalogos') || path.includes('/categorias')) return 'CATALOGOS';
  if (path.includes('/usuarios')) return 'USUARIOS';
  if (path.includes('/conocimiento')) return 'CONOCIMIENTO';
  if (path.includes('/asistente')) return 'ASISTENTE';
  if (path.includes('/metricas') || path.includes('/dashboard')) return 'METRICAS';
  if (path.includes('/encuestas')) return 'ENCUESTAS';
  if (path.includes('/integraciones')) return 'INTEGRACIONES';
  if (path.includes('/administracion')) return 'ADMINISTRACION';
  return 'OTROS';
}

function tabLabel(element) {
  if (!element) return '';
  const text = String(
    element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
    || element.textContent
    || '',
  ).replace(/\s+/g, ' ').trim();
  return text.slice(0, 180);
}

function activeTabLabel() {
  const candidates = [
    '[role="tab"][aria-selected="true"]',
    '.metrics-tabs .is-active',
    '[class*="tabs"] .is-active',
    '[class*="tab-list"] .is-active',
  ];
  for (const selector of candidates) {
    const found = document.querySelector(selector);
    const label = tabLabel(found);
    if (label) return label;
  }
  return '';
}

function pageLabel(pathname = '', section = '') {
  const path = String(pathname || '').toLowerCase();
  if (!path || path === '/') return 'Inicio';
  if (/\/boletas\/(nueva|nuevo)/.test(path)) return 'Crear boleta';
  if (/\/mantenimientos\/(nuevo|nueva)/.test(path)) return 'Crear mantenimiento';
  if (path.includes('/agenda')) return 'Agenda';
  if (path.includes('/boletas')) return 'Boletas';
  if (path.includes('/mantenimientos')) return 'Mantenimientos';
  if (path.includes('/casos')) return 'Casos';
  if (path.includes('/clientes')) return 'Clientes';
  if (path.includes('/credenciales')) return 'Credenciales';
  if (path.includes('/usuarios')) return 'Usuarios';
  if (path.includes('/conocimiento')) return 'Base de conocimientos';
  if (path.includes('/asistente')) return 'Asistente';
  if (path.includes('/metricas') || path.includes('/dashboard')) return 'Métricas';
  if (path.includes('/encuestas')) return 'Encuestas';
  if (path.includes('/integraciones')) return 'Integraciones';
  if (path.includes('/administracion')) return 'Administración';
  return section || 'Otra sección';
}

export default function ActivityTelemetryBridge() {
  const { sessionToken } = useAuth();
  const location = useLocation();
  const routeRef = useRef('');
  const sectionRef = useRef('OTROS');
  const viewRef = useRef('');
  const segmentStartedRef = useRef(Date.now());
  const lastTickRef = useRef(Date.now());
  const lastFlushRef = useRef(Date.now());
  const lastInteractionRef = useRef(Date.now());
  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const visibleMsRef = useRef(0);
  const interactionCountRef = useRef(0);

  useEffect(() => {
    if (!sessionToken) return undefined;

    function markInteraction() {
      lastInteractionRef.current = Date.now();
      interactionCountRef.current += 1;
    }

    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((name) => window.addEventListener(name, markInteraction, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, markInteraction));
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return undefined;

    const route = `${location.pathname}${location.search || ''}`;
    const startedAt = Date.now();
    routeRef.current = route;
    sectionRef.current = sectionForPath(location.pathname);
    viewRef.current = '';
    segmentStartedRef.current = startedAt;
    lastTickRef.current = startedAt;
    lastFlushRef.current = startedAt;
    visibleRef.current = document.visibilityState === 'visible';
    visibleMsRef.current = 0;
    interactionCountRef.current = 0;

    function accumulate(now = Date.now()) {
      const elapsed = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      if (visibleRef.current) visibleMsRef.current += elapsed;
      visibleRef.current = document.visibilityState === 'visible';
    }

    function flush(keepalive = false, force = false) {
      const now = Date.now();
      accumulate(now);
      const durationMs = visibleMsRef.current;
      if (!force && durationMs < 1_000) return;
      if (durationMs < 250) return;

      const payload = {
        type: 'PAGE_TIME',
        section: sectionRef.current,
        route: routeRef.current,
        view: viewRef.current,
        startedAt: new Date(segmentStartedRef.current).toISOString(),
        endedAt: new Date(now).toISOString(),
        durationSeconds: Math.round(durationMs / 100) / 10,
        action: 'PERMANENCIA VISIBLE EN APP',
        detail: {
          measurement: 'VISIBLE_APP_TIME',
          visibleAtFlush: document.visibilityState === 'visible',
          interactionCount: interactionCountRef.current,
          lastInteractionAt: new Date(lastInteractionRef.current).toISOString(),
        },
      };
      visibleMsRef.current = 0;
      interactionCountRef.current = 0;
      segmentStartedRef.current = now;
      lastFlushRef.current = now;
      void sendActivityEvent(sessionToken, payload, { keepalive }).catch(() => {});
    }

    const detectTimer = window.setTimeout(() => {
      viewRef.current = activeTabLabel();
      const now = new Date().toISOString();
      void sendActivityEvent(sessionToken, {
        type: 'PAGE_VIEW',
        section: sectionRef.current,
        route,
        view: viewRef.current,
        startedAt: now,
        endedAt: now,
        durationSeconds: 0,
        action: 'ENTRAR A SECCIÓN',
        detail: {
          title: document.title,
          page: pageLabel(location.pathname, sectionRef.current),
        },
      }).catch(() => {});
    }, PAGE_VIEW_DELAY_MS);

    function handleVisibility() {
      accumulate(Date.now());
      if (document.visibilityState === 'hidden') flush(true, true);
    }

    function handlePageHide() {
      flush(true, true);
    }

    function handleExternalFlush() {
      flush(false, true);
    }

    function handleTabClick(event) {
      const target = event.target?.closest?.('[role="tab"], .metrics-tabs button, [class*="tabs"] button, [class*="tab-list"] button');
      if (!target) return;
      const label = tabLabel(target);
      if (!label || label === viewRef.current) return;
      const previousView = viewRef.current;
      flush(false, true);
      viewRef.current = label;
      segmentStartedRef.current = Date.now();
      lastTickRef.current = Date.now();
      lastInteractionRef.current = Date.now();
      interactionCountRef.current += 1;
      const now = new Date().toISOString();
      void sendActivityEvent(sessionToken, {
        type: 'UI_TAB',
        section: sectionRef.current,
        route: routeRef.current,
        view: label,
        startedAt: now,
        endedAt: now,
        durationSeconds: 0,
        action: 'CAMBIAR PESTAÑA',
        detail: { from: previousView, to: label },
      }).catch(() => {});
    }

    const timer = window.setInterval(() => {
      const now = Date.now();
      accumulate(now);
      if (now - lastFlushRef.current >= FLUSH_MS) flush(false, true);
    }, TICK_MS);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener(ACTIVITY_FLUSH_EVENT, handleExternalFlush);
    document.addEventListener('click', handleTabClick, true);

    return () => {
      window.clearTimeout(detectTimer);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener(ACTIVITY_FLUSH_EVENT, handleExternalFlush);
      document.removeEventListener('click', handleTabClick, true);
      flush(true, true);
    };
  }, [location.pathname, location.search, sessionToken]);

  return null;
}
