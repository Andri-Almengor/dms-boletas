import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { sendActivityEvent } from '../../services/activityReportApi';

const IDLE_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 10 * 1000;
const FLUSH_MS = 60 * 1000;

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
  const activeMsRef = useRef(0);

  useEffect(() => {
    if (!sessionToken) return undefined;

    function markInteraction() {
      lastInteractionRef.current = Date.now();
    }

    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((name) => window.addEventListener(name, markInteraction, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, markInteraction));
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return undefined;

    const route = `${location.pathname}${location.search || ''}`;
    routeRef.current = route;
    sectionRef.current = sectionForPath(location.pathname);
    viewRef.current = '';
    segmentStartedRef.current = Date.now();
    lastTickRef.current = Date.now();
    lastFlushRef.current = Date.now();
    activeMsRef.current = 0;

    const detectTimer = window.setTimeout(() => {
      viewRef.current = activeTabLabel();
    }, 250);

    void sendActivityEvent(sessionToken, {
      type: 'PAGE_VIEW',
      section: sectionRef.current,
      route,
      view: viewRef.current,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 0,
      detail: { title: document.title },
    }).catch(() => {});

    function accumulate(now = Date.now()) {
      const elapsed = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      const visible = document.visibilityState === 'visible';
      const active = now - lastInteractionRef.current <= IDLE_AFTER_MS;
      if (visible && active) activeMsRef.current += elapsed;
    }

    function flush(keepalive = false, force = false) {
      const now = Date.now();
      accumulate(now);
      const durationMs = activeMsRef.current;
      if (!force && durationMs < 1_000) return;
      if (durationMs < 250) return;

      const startedAt = new Date(segmentStartedRef.current).toISOString();
      const endedAt = new Date(now).toISOString();
      const payload = {
        type: 'PAGE_TIME',
        section: sectionRef.current,
        route: routeRef.current,
        view: viewRef.current,
        startedAt,
        endedAt,
        durationSeconds: Math.round(durationMs / 100) / 10,
        detail: {
          visible: document.visibilityState === 'visible',
          idleLimitMinutes: IDLE_AFTER_MS / 60000,
        },
      };
      activeMsRef.current = 0;
      segmentStartedRef.current = now;
      lastFlushRef.current = now;
      void sendActivityEvent(sessionToken, payload, { keepalive }).catch(() => {});
    }

    function handleVisibility() {
      accumulate(Date.now());
      if (document.visibilityState === 'hidden') flush(true, true);
    }

    function handlePageHide() {
      flush(true, true);
    }

    function handleTabClick(event) {
      const target = event.target?.closest?.('[role="tab"], .metrics-tabs button, [class*="tabs"] button, [class*="tab-list"] button');
      if (!target) return;
      const label = tabLabel(target);
      if (!label || label === viewRef.current) return;
      flush(false, true);
      viewRef.current = label;
      segmentStartedRef.current = Date.now();
      void sendActivityEvent(sessionToken, {
        type: 'UI_TAB',
        section: sectionRef.current,
        route: routeRef.current,
        view: label,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: 0,
        action: 'CAMBIAR PESTAÑA',
        detail: { tab: label },
      }).catch(() => {});
    }

    const timer = window.setInterval(() => {
      const now = Date.now();
      accumulate(now);
      if (now - lastFlushRef.current >= FLUSH_MS) flush(false, true);
    }, TICK_MS);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('click', handleTabClick, true);

    return () => {
      window.clearTimeout(detectTimer);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('click', handleTabClick, true);
      flush(true, true);
    };
  }, [location.pathname, location.search, sessionToken]);

  return null;
}
