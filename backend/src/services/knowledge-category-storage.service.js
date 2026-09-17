import { ensureColumns } from '../infra/sheets.repository.js';

export const KNOWLEDGE_CATEGORY_RELATION_SHEET = 'KnowledgeArticleCategories';
export const KNOWLEDGE_CATEGORY_RELATION_HEADERS = [
  'RelacionArticuloCategoriaID',
  'TutorialID',
  'CategoriaConocimientoID',
  'Orden',
  'Activo',
  'CreadoPor',
  'FechaCreacion',
  'ActualizadoPor',
  'FechaActualizacion',
];

let ensurePromise = null;
let ensured = false;

export async function ensureKnowledgeCategoryStorage() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = ensureColumns(
    KNOWLEDGE_CATEGORY_RELATION_SHEET,
    KNOWLEDGE_CATEGORY_RELATION_HEADERS,
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
