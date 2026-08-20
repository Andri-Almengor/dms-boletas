export const KNOWLEDGE_CONTENT_CHUNK_SIZE = 40_000;

export function splitKnowledgeContent(value) {
  const text = String(value ?? '');
  if (!text.length) return [''];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + KNOWLEDGE_CONTENT_CHUNK_SIZE);

    // Evita cortar un par sustituto UTF-16 entre dos celdas. Los fragmentos
    // pueden partir HTML en cualquier punto porque se vuelven a concatenar
    // exactamente antes de entregarlos al frontend.
    if (
      end < text.length
      && end > start
      && text.charCodeAt(end - 1) >= 0xD800
      && text.charCodeAt(end - 1) <= 0xDBFF
      && text.charCodeAt(end) >= 0xDC00
      && text.charCodeAt(end) <= 0xDFFF
    ) {
      end -= 1;
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

export function isLongKnowledgeContent(value) {
  return String(value ?? '').length > KNOWLEDGE_CONTENT_CHUNK_SIZE;
}

export function firstKnowledgeContentChunk(value) {
  return splitKnowledgeContent(value)[0] || '';
}

export function joinKnowledgeContentChunks(chunks = []) {
  return (chunks || []).map((value) => String(value ?? '')).join('');
}
