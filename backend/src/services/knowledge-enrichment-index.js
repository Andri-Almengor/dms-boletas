export function isActiveKnowledgeRelation(row) {
  return row?.Activo !== false
    && String(row?.Activo ?? 'true').toLowerCase() !== 'false'
    && String(row?.Estado || '').toUpperCase() !== 'INACTIVO';
}

function appendGrouped(map, key, value) {
  const group = map.get(key);
  if (group) {
    group.push(value);
    return;
  }
  map.set(key, [value]);
}

export function buildKnowledgeEnrichmentIndex({
  attachments = [],
  categories = [],
  users = [],
  relations = [],
} = {}) {
  const categoriesById = new Map();
  for (const item of categories) {
    categoriesById.set(String(item.CategoriaConocimientoID), item);
  }

  const usersById = new Map();
  for (const item of users) {
    const id = String(item.UsuarioID);
    if (!usersById.has(id)) usersById.set(id, item);
  }

  const attachmentsByTutorialId = new Map();
  for (const item of attachments) {
    if (item.Activo === false) continue;
    const tutorialId = String(item.TutorialID || item.ArticuloID || item.ArticuloRef);
    appendGrouped(attachmentsByTutorialId, tutorialId, item);
  }

  const relationsByTutorialId = new Map();
  for (const row of relations) {
    if (!isActiveKnowledgeRelation(row)) continue;
    const tutorialId = String(row.TutorialID || '');
    appendGrouped(relationsByTutorialId, tutorialId, row);
  }
  for (const related of relationsByTutorialId.values()) {
    related.sort((a, b) => Number(a.Orden || 0) - Number(b.Orden || 0));
  }

  return {
    categoriesById,
    usersById,
    attachmentsByTutorialId,
    relationsByTutorialId,
  };
}

export function indexedArticleCategoryIds(article, enrichmentIndex) {
  const tutorialId = String(article.TutorialID || article.ArticuloID || '');
  const related = (enrichmentIndex?.relationsByTutorialId.get(tutorialId) || [])
    .map((row) => String(row.CategoriaConocimientoID || '').trim())
    .filter(Boolean);
  const unique = [...new Set(related)];
  if (unique.length) return unique;
  const legacy = String(article.CategoriaConocimientoID || '').trim();
  return legacy ? [legacy] : [];
}
