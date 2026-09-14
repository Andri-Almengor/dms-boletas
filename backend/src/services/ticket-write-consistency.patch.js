import { pick } from '../core/utils.js';
import { ticketHandlers } from '../modules/tickets.module.js';

const INSTALL_FLAG = Symbol.for('dms.ticketWriteConsistencyPatch');
const writeTails = new Map();
const acceptedRevisions = new Map();
const MAX_TRACKED_TICKETS = 1_000;

function clean(value) {
  return String(value ?? '').trim();
}

function revision(value) {
  const numeric = Number(value || 0);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function withTicketWrite(ticketId, operation) {
  const key = clean(ticketId);
  const previous = writeTails.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const settled = current.catch(() => {});
  writeTails.set(key, settled);
  settled.finally(() => {
    if (writeTails.get(key) === settled) writeTails.delete(key);
  });
  return current;
}

function rememberRevision(ticketId, nextRevision) {
  if (!nextRevision) return;
  const key = clean(ticketId);
  acceptedRevisions.delete(key);
  acceptedRevisions.set(key, { revision: nextRevision, seenAt: Date.now() });
  while (acceptedRevisions.size > MAX_TRACKED_TICKETS) {
    acceptedRevisions.delete(acceptedRevisions.keys().next().value);
  }
}

if (!ticketHandlers[INSTALL_FLAG]) {
  const originalAutosave = ticketHandlers.autosave;
  ticketHandlers.autosave = async (ctx) => {
    const ticketId = clean(pick(ctx.payload, ['boletaUid', 'BoletaUID', 'id']));
    const clientRevision = revision(ctx.payload?.__clientRevision);
    if (!ticketId || !clientRevision) return originalAutosave(ctx);

    return withTicketWrite(ticketId, async () => {
      const previousRevision = Number(acceptedRevisions.get(ticketId)?.revision || 0);
      if (previousRevision && clientRevision < previousRevision) {
        return {
          autosaved: false,
          stale: true,
          ignoredRevision: clientRevision,
          acceptedRevision: previousRevision,
        };
      }

      const result = await originalAutosave(ctx);
      if (!result?.throttled) rememberRevision(ticketId, Math.max(previousRevision, clientRevision));
      return result;
    });
  };

  ticketHandlers[INSTALL_FLAG] = true;
}

export function ticketWriteConsistencySnapshot() {
  return {
    activeWrites: writeTails.size,
    trackedTickets: acceptedRevisions.size,
    maxTrackedTickets: MAX_TRACKED_TICKETS,
  };
}
