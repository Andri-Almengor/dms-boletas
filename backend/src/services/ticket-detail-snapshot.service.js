import { findById, findRows, readTable } from '../infra/sheets.repository.js';

function clean(value) { return String(value ?? '').trim(); }
function groupId(ticket = {}) { return clean(ticket.GrupoVisitaID || ticket.BoletaPrincipalUID || ticket.BoletaUID); }
function rootId(ticket = {}) { return clean(ticket.BoletaPrincipalUID || ticket.BoletaUID); }

// Request-scoped snapshot for one ticket detail. Critical large relations are
// narrowed in PostgreSQL instead of materializing complete tables in memory.
export function createTicketDetailSnapshot(seedTicket = null) {
  const entries = new Map();
  const seedId = clean(seedTicket?.BoletaUID);
  let located;

  async function currentTicket() {
    if (!seedId) return seedTicket || null;
    return findById('Boletas', seedId).catch(() => seedTicket || null);
  }

  async function visitRows() {
    const ticket = await currentTicket();
    if (!ticket?.BoletaUID) return [];
    const group = groupId(ticket);
    const root = rootId(ticket);
    const batches = await Promise.all([
      group ? findRows('Boletas', { GrupoVisitaID: group }, { limit: 5000 }) : Promise.resolve([]),
      root ? findRows('Boletas', { BoletaPrincipalUID: root }, { limit: 5000 }) : Promise.resolve([]),
      root ? findRows('Boletas', { BoletaUID: root }, { limit: 2 }) : Promise.resolve([]),
    ]);
    const unique = new Map();
    for (const row of [ticket, ...batches.flat()]) {
      const id = clean(row?.BoletaUID);
      if (id) unique.set(id, row);
    }
    return [...unique.values()];
  }

  async function narrowed(name, options = {}) {
    if (name === 'Boletas') return visitRows();
    if (name === 'BoletaAsignados' || name === 'EvidenciasBoleta') {
      const ids = (await visitRows()).map((row) => clean(row.BoletaUID)).filter(Boolean);
      return ids.length ? findRows(name, { BoletaUID: ids }, { limit: 50_000 }) : [];
    }
    if (name === 'Usuarios') {
      const assignments = await read('BoletaAsignados');
      const ids = [...new Set(assignments.map((row) => clean(row.UsuarioID)).filter(Boolean))];
      return ids.length ? findRows('Usuarios', { UsuarioID: ids }, { limit: 50_000 }) : [];
    }
    return readTable(name, options);
  }

  async function read(name, options = {}) {
    if (entries.has(name)) return entries.get(name);
    const promise = narrowed(name, options).catch((error) => {
      if (entries.get(name) === promise) entries.delete(name);
      throw error;
    });
    entries.set(name, promise);
    return promise;
  }

  return {
    read,
    async tables(names) {
      const values = await Promise.all(names.map((name) => read(name)));
      return Object.fromEntries(names.map((name, index) => [name, values[index]]));
    },
    locate(rows, id) {
      if (located?.rows === rows && located.id === id) return located.ticket;
      const ticket = rows.find((row) => clean(row.BoletaUID) === clean(id));
      located = { rows, id, ticket };
      return ticket;
    },
  };
}
