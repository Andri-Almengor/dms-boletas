import { badRequest } from '../core/errors.js';
import {
  appendRows,
  readTable,
  updateRows,
} from '../infra/sheets.repository.js';
import {
  DEFAULT_AGENDA_TICKET_EXCEPTIONS,
  normalizeAgendaText,
} from './agenda-domain.service.js';

const CONFIG_KEY = 'AGENDA_BOLETA_EXCEPCIONES';
const MAX_EXCEPTIONS = 100;
const MAX_EXCEPTION_LENGTH = 120;
let seedPromise = null;

function clean(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function splitRawExceptions(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitRawExceptions(item));
  const text = clean(value, 30000);
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return splitRawExceptions(parsed);
    } catch {
      // Si no es JSON válido, se procesa como texto normal.
    }
  }
  return text
    .split(/[;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeAgendaTicketExceptionSettings(value) {
  const raw = splitRawExceptions(value);
  const result = [];
  const used = new Set();

  raw.forEach((item) => {
    const display = clean(item, MAX_EXCEPTION_LENGTH);
    const normalized = normalizeAgendaText(display);
    if (!normalized || used.has(normalized)) return;
    used.add(normalized);
    result.push(display);
  });

  if (result.length > MAX_EXCEPTIONS) {
    throw badRequest(`Las excepciones de Agenda permiten un máximo de ${MAX_EXCEPTIONS} palabras o frases.`);
  }
  return result;
}

function rowsMap(rows = []) {
  return new Map(rows
    .filter((row) => clean(row.Clave))
    .map((row) => [clean(row.Clave), clean(row.Valor, 30000)]));
}

function serialize(exceptions) {
  return JSON.stringify(normalizeAgendaTicketExceptionSettings(exceptions));
}

async function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const rows = await readTable('Configuracion');
      const map = rowsMap(rows);
      if (!map.has(CONFIG_KEY)) {
        await appendRows('Configuracion', [{
          Clave: CONFIG_KEY,
          Valor: serialize(DEFAULT_AGENDA_TICKET_EXCEPTIONS),
        }]);
      }
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

export async function getAgendaTicketExceptionSettings() {
  await ensureSeeded();
  const rows = await readTable('Configuracion');
  const map = rowsMap(rows);
  const configured = normalizeAgendaTicketExceptionSettings(map.get(CONFIG_KEY));
  return {
    exceptions: configured.length ? configured : [...DEFAULT_AGENDA_TICKET_EXCEPTIONS],
  };
}

export async function getAgendaTicketExceptions() {
  const settings = await getAgendaTicketExceptionSettings();
  return settings.exceptions;
}

export async function updateAgendaTicketExceptionSettings(payload = {}) {
  await ensureSeeded();
  const exceptions = normalizeAgendaTicketExceptionSettings(
    payload.exceptions ?? payload.excepciones ?? payload.words ?? payload.palabras ?? [],
  );
  if (!exceptions.length) {
    throw badRequest('Configure al menos una palabra o frase de excepción para la Agenda.');
  }

  const rows = await readTable('Configuracion', { force: true });
  const exists = rows.some((row) => clean(row.Clave) === CONFIG_KEY);
  const record = { Clave: CONFIG_KEY, Valor: serialize(exceptions) };
  if (exists) await updateRows('Configuracion', [{ idValue: CONFIG_KEY, patch: record }], 'Clave');
  else await appendRows('Configuracion', [record]);
  return { exceptions };
}

export const AGENDA_TICKET_EXCEPTIONS_CONFIG_KEY = CONFIG_KEY;
