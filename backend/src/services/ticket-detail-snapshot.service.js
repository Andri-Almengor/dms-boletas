import { readTable } from '../infra/sheets.repository.js';
import { sheetsRevisionTracker } from '../infra/google.js';

// Lifetime is one tickets.get. Known writes/schema repairs invalidate only the
// affected entries through the repository's existing revision tracker.
export function createTicketDetailSnapshot() {
  const entries = new Map();
  let located;
  return {
    read(name, options = {}) {
      const entry = entries.get(name);
      if (entry && sheetsRevisionTracker.isCurrent(entry.revision)) return entry.promise;
      const revision = sheetsRevisionTracker.snapshot(new Set([name]));
      const next = { revision, promise: null };
      next.promise = readTable(name, options).catch(error => {
        if (entries.get(name) === next) entries.delete(name);
        throw error;
      });
      entries.set(name, next);
      return next.promise;
    },
    async tables(names) {
      const values = await Promise.all(names.map(name => this.read(name)));
      return Object.fromEntries(names.map((name, i) => [name, values[i]]));
    },
    locate(rows, id) {
      if (located?.rows === rows && located.id === id) return located.ticket;
      const ticket = rows.find(row => String(row.BoletaUID ?? '').trim() === id);
      located = { rows, id, ticket };
      return ticket;
    },
  };
}
