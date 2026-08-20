import { env } from '../config/env.js';
import {
  appendRows,
  getHeaders,
  invalidateTableCache,
  readTable,
  updateRows,
} from '../infra/sheets.repository.js';
import { sheetsApi } from '../infra/google.js';
import { nowIso, uuid } from '../core/utils.js';
import { joinKnowledgeContentChunks, splitKnowledgeContent } from './knowledge-content-chunks.js';

export const KNOWLEDGE_CONTENT_SHEET = 'KnowledgeArticleContent';
export const KNOWLEDGE_CONTENT_HEADERS = [
  'ContenidoParteID',
  'TutorialID',
  'Parte',
  'Contenido',
  'Activo',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
];

let ensurePromise = null;
let ensured = false;

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let number = index + 1;
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function isActive(row) {
  return row?.Activo !== false
    && String(row?.Activo ?? 'true').toLowerCase() !== 'false'
    && String(row?.Estado || '').toUpperCase() !== 'INACTIVO';
}

async function ensureHeaders() {
  const range = `${quote(KNOWLEDGE_CONTENT_SHEET)}!1:1`;
  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: env.sheetId,
    range,
  });
  const current = (data.values?.[0] || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const missing = KNOWLEDGE_CONTENT_HEADERS.filter((header) => !current.includes(header));
  const headers = current.length ? [...current, ...missing] : [...KNOWLEDGE_CONTENT_HEADERS];

  if (!current.length || missing.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.sheetId,
      range: `${quote(KNOWLEDGE_CONTENT_SHEET)}!A1:${columnLetter(headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  invalidateTableCache(KNOWLEDGE_CONTENT_SHEET);
  await getHeaders(KNOWLEDGE_CONTENT_SHEET, true);
}

export async function ensureKnowledgeLongContentStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId: env.sheetId,
      fields: 'sheets.properties.title',
    });
    const exists = (data.sheets || []).some(
      (sheet) => sheet.properties?.title === KNOWLEDGE_CONTENT_SHEET,
    );

    if (!exists) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: KNOWLEDGE_CONTENT_SHEET } } }],
        },
      });
    }

    await ensureHeaders();
    ensured = true;
  })().catch((error) => {
    ensured = false;
    throw error;
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export async function readKnowledgeArticleContents(tutorialIds = []) {
  const ids = [...new Set((tutorialIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  await ensureKnowledgeLongContentStorage();
  const wanted = new Set(ids);
  const rows = await readTable(KNOWLEDGE_CONTENT_SHEET);
  const grouped = new Map();

  rows.forEach((row) => {
    const tutorialId = String(row.TutorialID || '').trim();
    if (!wanted.has(tutorialId) || !isActive(row)) return;
    if (!grouped.has(tutorialId)) grouped.set(tutorialId, []);
    grouped.get(tutorialId).push(row);
  });

  const result = new Map();
  grouped.forEach((parts, tutorialId) => {
    const content = joinKnowledgeContentChunks(
      parts
        .sort((a, b) => Number(a.Parte || 0) - Number(b.Parte || 0))
        .map((row) => row.Contenido || ''),
    );
    result.set(tutorialId, content);
  });

  return result;
}

export async function replaceKnowledgeArticleContent(tutorialId, content, actor = '') {
  const id = String(tutorialId || '').trim();
  if (!id) throw new Error('TutorialID es obligatorio para guardar contenido largo.');

  await ensureKnowledgeLongContentStorage();
  const chunks = splitKnowledgeContent(content);
  const rows = await readTable(KNOWLEDGE_CONTENT_SHEET, { force: true });
  const related = rows
    .filter((row) => String(row.TutorialID || '') === id)
    .sort((a, b) => Number(a.Parte || 0) - Number(b.Parte || 0));
  const timestamp = nowIso();
  const updates = [];
  const creates = [];

  chunks.forEach((chunk, index) => {
    const reusable = related[index];
    if (reusable?.ContenidoParteID) {
      updates.push({
        idValue: reusable.ContenidoParteID,
        patch: {
          TutorialID: id,
          Parte: index + 1,
          Contenido: chunk,
          Activo: true,
          ActualizadoPor: actor,
          FechaActualizacion: timestamp,
        },
      });
      return;
    }

    creates.push({
      ContenidoParteID: uuid(),
      TutorialID: id,
      Parte: index + 1,
      Contenido: chunk,
      Activo: true,
      CreadoPor: actor,
      FechaCreacion: timestamp,
      ActualizadoPor: actor,
      FechaActualizacion: timestamp,
    });
  });

  related.slice(chunks.length).forEach((row) => {
    if (!row.ContenidoParteID || !isActive(row)) return;
    updates.push({
      idValue: row.ContenidoParteID,
      patch: {
        Activo: false,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    });
  });

  if (updates.length) await updateRows(KNOWLEDGE_CONTENT_SHEET, updates, 'ContenidoParteID');
  if (creates.length) await appendRows(KNOWLEDGE_CONTENT_SHEET, creates);

  return { tutorialId: id, parts: chunks.length, length: String(content ?? '').length };
}

export async function deactivateKnowledgeArticleContent(tutorialId, actor = '') {
  const id = String(tutorialId || '').trim();
  if (!id) return;

  await ensureKnowledgeLongContentStorage();
  const rows = await readTable(KNOWLEDGE_CONTENT_SHEET, { force: true });
  const timestamp = nowIso();
  const updates = rows
    .filter((row) => String(row.TutorialID || '') === id && isActive(row) && row.ContenidoParteID)
    .map((row) => ({
      idValue: row.ContenidoParteID,
      patch: {
        Activo: false,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    }));

  if (updates.length) await updateRows(KNOWLEDGE_CONTENT_SHEET, updates, 'ContenidoParteID');
}
