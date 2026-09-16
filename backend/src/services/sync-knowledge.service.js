function clean(value) {
  return String(value ?? '').trim();
}

function inaccessible(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '').toUpperCase();
  return status === 403 || status === 404 || code === 'FORBIDDEN' || code === 'NOT_FOUND';
}

function articleItem(result = {}) {
  return result?.item || result?.article || result?.articulo || result || null;
}

export async function materializeKnowledgeDelta(events = [], loadArticle) {
  const upserts = [];
  const removed = [];
  const detailById = new Map();

  for (const event of events) {
    const id = clean(event?.EntityID);
    if (!id) continue;
    if (String(event?.Operation || '').toUpperCase() === 'DELETE') {
      removed.push(id);
      continue;
    }

    try {
      const detail = await loadArticle(id);
      const item = articleItem(detail);
      if (!item || !clean(item.TutorialID || item.tutorialId || item.id)) {
        removed.push(id);
        continue;
      }
      upserts.push(item);
      detailById.set(id, detail);
    } catch (error) {
      if (!inaccessible(error)) throw error;
      removed.push(id);
    }
  }

  return {
    upserts,
    removed,
    invalidated: [],
    counts: null,
    detailById,
  };
}
