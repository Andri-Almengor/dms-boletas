import { MODULE_ROUTES, requestAvailable } from './moduleApi';
import { createAbortError, throwIfAborted } from './requestErrors';

const inflight = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function resourceKey(boletaUid, sessionToken) {
  return `${clean(boletaUid)}\u001f${clean(sessionToken)}`;
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : createAbortError();
}

function maybeAbort(entry) {
  if (entry.settled || entry.consumers.size) return;
  entry.controller.abort(createAbortError());
}

function subscribe(entry, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const consumer = { settled: false, signal, onAbort: null };

    function cleanup() {
      if (consumer.signal && consumer.onAbort) consumer.signal.removeEventListener('abort', consumer.onAbort);
      entry.consumers.delete(consumer);
    }

    consumer.onAbort = () => {
      if (consumer.settled) return;
      consumer.settled = true;
      cleanup();
      reject(abortReason(signal));
      maybeAbort(entry);
    };

    entry.consumers.add(consumer);
    signal?.addEventListener('abort', consumer.onAbort, { once: true });

    entry.promise.then(
      (value) => {
        if (consumer.settled) return;
        consumer.settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (consumer.settled) return;
        consumer.settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export function loadTicketDetail(boletaUid, sessionToken, { signal } = {}) {
  const ticketId = clean(boletaUid);
  const token = clean(sessionToken);
  if (!ticketId) return Promise.reject(new Error('No se indicó la boleta solicitada.'));
  throwIfAborted(signal);

  const key = resourceKey(ticketId, token);
  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      consumers: new Set(),
      settled: false,
      promise: null,
    };
    entry.promise = requestAvailable(
      MODULE_ROUTES.tickets.get,
      { boletaUid: ticketId, id: ticketId },
      token,
      { signal: controller.signal },
    ).finally(() => {
      entry.settled = true;
      if (inflight.get(key) === entry) inflight.delete(key);
    });
    inflight.set(key, entry);
  }

  return subscribe(entry, signal);
}

export function ticketDetailResourceSnapshot() {
  return {
    inflight: inflight.size,
    consumers: [...inflight.values()].reduce((total, entry) => total + entry.consumers.size, 0),
  };
}

export function resetTicketDetailResourceForTests() {
  for (const entry of inflight.values()) entry.controller.abort(createAbortError());
  inflight.clear();
}
