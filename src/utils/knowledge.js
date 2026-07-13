export function pickKnowledge(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

export function getKnowledgeId(record) {
  return String(pickKnowledge(record, ['TutorialID', 'ArticuloID', 'KnowledgeID', 'id'], ''));
}

export function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'object') return [value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return String(value).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }
}

export function normalizeKnowledge(record = {}) {
  return {
    raw: record,
    id: getKnowledgeId(record),
    title: pickKnowledge(record, ['Titulo', 'Título', 'title'], 'Tutorial sin título'),
    categoryId: String(pickKnowledge(record, ['CategoriaConocimientoID', 'CategoriaID', 'categoryId'], '')),
    category: pickKnowledge(record, ['Categoria', 'CategoriaNombre', 'category'], 'Sin categoría'),
    problem: pickKnowledge(record, ['ProblemaResuelto', 'DescripcionProblema', 'Problema', 'problem'], ''),
    content: pickKnowledge(record, ['ContenidoHTML', 'Contenido', 'contentHtml', 'content'], ''),
    status: String(pickKnowledge(record, ['Estado', 'status'], 'PUBLICADO')).toUpperCase(),
    authorId: String(pickKnowledge(record, ['AutorUsuarioID', 'UsuarioID', 'authorId'], '')),
    author: pickKnowledge(record, ['AutorNombre', 'CreadoPor', 'authorName'], 'Equipo técnico'),
    createdAt: pickKnowledge(record, ['CreatedAt', 'FechaCreacion', 'createdAt'], ''),
    updatedAt: pickKnowledge(record, ['UpdatedAt', 'FechaActualizacion', 'updatedAt'], ''),
    videos: parseList(pickKnowledge(record, ['Videos', 'VideosJSON', 'videoUrls'], [])),
    attachments: parseList(pickKnowledge(record, ['Adjuntos', 'Attachments', 'attachments'], [])),
  };
}

export function stripHtml(html = '') {
  if (typeof document === 'undefined') return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
}

export function sanitizeKnowledgeHtml(html = '') {
  if (!html || typeof DOMParser === 'undefined') return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  const allowedTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'BR', 'HR', 'SPAN']);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach((attribute) => {
      if (node.tagName === 'A' && ['href', 'target', 'rel'].includes(attribute.name)) return;
      node.removeAttribute(attribute.name);
    });
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return root.innerHTML;
}

export function formatKnowledgeDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(date);
}

export function getVideoEmbedUrl(value) {
  const raw = typeof value === 'string' ? value : pickKnowledge(value, ['URL', 'Url', 'url'], '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtube.com')) {
      const id = url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (url.hostname.includes('vimeo.com')) {
      const id = url.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : '';
    }
  } catch {
    return '';
  }
  return '';
}

export function getAttachmentId(record) {
  return String(pickKnowledge(record, ['AdjuntoID', 'AttachmentID', 'id'], ''));
}

export function getAttachmentName(record) {
  return typeof record === 'string' ? record : pickKnowledge(record, ['Nombre', 'FileName', 'name'], 'Documento adjunto');
}

export function getAttachmentUrl(record) {
  return typeof record === 'string' ? record : pickKnowledge(record, ['DriveURL', 'Url', 'URL', 'url'], '');
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
