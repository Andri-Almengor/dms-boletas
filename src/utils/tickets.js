import { pick } from '../services/moduleApi';

export function normalizeTicketStatus(ticket) {
  const status = String(pick(ticket, ['Estado', 'estado', 'Status', 'status'], '')).trim().toUpperCase();
  if (status.includes('FINAL')) return 'FINALIZADA';
  if (status.includes('PEND')) return 'PENDIENTE';
  return status || 'PENDIENTE';
}

export function getTicketId(ticket, fallback = '') {
  return pick(ticket, ['BoletaID', 'TicketID', 'ID', 'id', 'RowID'], fallback);
}

export function formatDate(value, options = {}) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit',
    month: options.long ? 'long' : 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function groupTicketsByDate(tickets) {
  const groups = new Map();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  tickets.forEach((ticket) => {
    const rawDate = pick(ticket, ['Fecha', 'FechaCreacion', 'CreatedAt', 'fecha']);
    const parsed = rawDate ? new Date(rawDate) : null;
    let label = 'Sin fecha';

    if (parsed && !Number.isNaN(parsed.getTime())) {
      if (parsed.toDateString() === today.toDateString()) label = 'Hoy';
      else if (parsed.toDateString() === yesterday.toDateString()) label = 'Ayer';
      else label = formatDate(parsed, { long: true });
    }

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ticket);
  });

  return Array.from(groups, ([label, items]) => ({ label, items }));
}

export function getEvidenceList(ticket) {
  const raw = pick(ticket, ['Evidencias', 'evidences', 'Imagenes', 'Fotos', 'Evidencia'], []);
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return raw.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }
}
