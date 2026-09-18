import {
  appendRows,
  ensureColumns,
  findRows,
  updateRows,
} from '../infra/sheets.repository.js';
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

const WRITE_BATCH_SIZE = 20;
let ensurePromise = null;
let ensured = false;

function isActive(row) {
  return row?.Activo !== false
    && String(row?.Activo ?? 'true').toLowerCase() !== 'false'
    && String(row?.Estado || '').toUpperCase() !== 'INACTIVO';
}

async function writeUpdatesInBatches(updates = []) {
  for (let offset = 0; offset < updates.length; offset += WRITE_BATCH_SIZE) {
    await updateRows(
      KNOWLEDGE_CONTENT_SHEET,
      updates.slice(offset, offset + WRITE_BATCH_SIZE),
      'ContenidoParteID',
    );
  }
}

export async function ensureKnowledgeLongContentStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = ensureColumns(
    KNOWLEDGE_CONTENT_SHEET,
    KNOWLEDGE_CONTENT_HEADERS,
  ).then(() => {
    ensured = true;
  }).catch((error) => {
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
  const rows = await findRows(KNOWLEDGE_CONTENT_SHEET, { TutorialID: ids }, { limit: 50_000 });
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
  const related = (await findRows(KNOWLEDGE_CONTENT_SHEET, { TutorialID: id }, { limit: 50_000 }))
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

  if (updates.length) await writeUpdatesInBatches(updates);
  if (creates.length) await appendRows(KNOWLEDGE_CONTENT_SHEET, creates, { chunkSize: WRITE_BATCH_SIZE });

  return { tutorialId: id, parts: chunks.length, length: String(content ?? '').length };
}

export async function deactivateKnowledgeArticleContent(tutorialId, actor = '') {
  const id = String(tutorialId || '').trim();
  if (!id) return;

  await ensureKnowledgeLongContentStorage();
  const rows = await findRows(KNOWLEDGE_CONTENT_SHEET, { TutorialID: id }, { limit: 50_000 });
  const timestamp = nowIso();
  const updates = rows
    .filter((row) => isActive(row) && row.ContenidoParteID)
    .map((row) => ({
      idValue: row.ContenidoParteID,
      patch: {
        Activo: false,
        ActualizadoPor: actor,
        FechaActualizacion: timestamp,
      },
    }));

  if (updates.length) await writeUpdatesInBatches(updates);
}
