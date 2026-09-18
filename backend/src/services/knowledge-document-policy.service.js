function stripMarkup(value = '') {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasKnowledgeGuideContribution({
  contentHtml = '',
  videos = [],
  pendingDocumentsCount = 0,
  existingDocumentCount = 0,
} = {}) {
  const videoCount = Array.isArray(videos)
    ? videos.map((value) => String(value || '').trim()).filter(Boolean).length
    : String(videos || '').trim() ? 1 : 0;
  return Boolean(
    stripMarkup(contentHtml)
    || videoCount
    || Number(pendingDocumentsCount || 0) > 0
    || Number(existingDocumentCount || 0) > 0
  );
}

export function validateKnowledgeGuideShape({
  title = '',
  categoryIds = [],
  contentHtml = '',
  videos = [],
  pendingDocumentsCount = 0,
  existingDocumentCount = 0,
} = {}) {
  if (!String(title || '').trim()) return { valid: false, reason: 'TITLE_REQUIRED' };
  if (!Array.isArray(categoryIds) || !categoryIds.map(String).map((value) => value.trim()).filter(Boolean).length) {
    return { valid: false, reason: 'CATEGORY_REQUIRED' };
  }
  if (!hasKnowledgeGuideContribution({ contentHtml, videos, pendingDocumentsCount, existingDocumentCount })) {
    return { valid: false, reason: 'CONTENT_REQUIRED' };
  }
  return { valid: true, reason: '' };
}
