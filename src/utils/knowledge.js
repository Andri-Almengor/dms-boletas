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

function normalizeCategoryObject(value, index = 0) {
  if (value && typeof value === 'object') {
    const id = String(pickKnowledge(value, ['CategoriaConocimientoID', 'CategoriaID', 'categoryId', 'id'], '')).trim();
    const name = String(pickKnowledge(value, ['Nombre', 'CategoriaNombre', 'name', 'label'], '')).trim();
    return id || name ? { id, name: name || `Categoría ${index + 1}`, order: Number(pickKnowledge(value, ['Orden', 'order'], index + 1)) } : null;
  }
  const text = String(value || '').trim();
  return text ? { id: text, name: '', order: index + 1 } : null;
}

export function normalizeKnowledgeCategories(record = {}) {
  const rawCategories = parseList(pickKnowledge(record, ['Categorias', 'Categories', 'categories'], []));
  const rawIds = parseList(pickKnowledge(record, ['CategoriaConocimientoIDs', 'CategoriaIDs', 'categoryIds'], []));
  const byId = new Map();
  const withoutId = [];

  rawCategories.forEach((value, index) => {
    const category = normalizeCategoryObject(value, index);
    if (!category) return;
    if (category.id) byId.set(category.id, category);
    else withoutId.push(category);
  });

  rawIds.forEach((value, index) => {
    const id = String(value && typeof value === 'object'
      ? pickKnowledge(value, ['CategoriaConocimientoID', 'CategoriaID', 'categoryId', 'id'], '')
      : value || '').trim();
    if (!id) return;
    if (!byId.has(id)) byId.set(id, { id, name: '', order: index + 1 });
  });

  const legacyId = String(pickKnowledge(record, ['CategoriaConocimientoID', 'CategoriaID', 'categoryId'], '')).trim();
  const legacyName = String(pickKnowledge(record, ['CategoriaPrincipalNombre', 'CategoriaNombre', 'Categoria', 'category'], '')).trim();
  if (!byId.size && legacyId) byId.set(legacyId, { id: legacyId, name: legacyName || 'Sin categoría', order: 1 });
  if (!byId.size && !legacyId && legacyName) withoutId.push({ id: '', name: legacyName, order: 1 });

  const categories = [...byId.values(), ...withoutId]
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((category, index) => ({
      ...category,
      name: category.name || (index === 0 && legacyName ? legacyName : `Categoría ${index + 1}`),
    }));

  return categories;
}

export function normalizeKnowledge(record = {}) {
  const categories = normalizeKnowledgeCategories(record);
  const categoryIds = categories.map((category) => category.id).filter(Boolean);
  const categoryNames = categories.map((category) => category.name).filter(Boolean);
  return {
    raw: record,
    id: getKnowledgeId(record),
    title: pickKnowledge(record, ['Titulo', 'Título', 'title'], 'Tutorial sin título'),
    categoryId: categoryIds[0] || '',
    categoryIds,
    categories,
    category: categoryNames.join(' + ') || 'Sin categoría',
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
  if (typeof document === 'undefined') {
    const text = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || (/\<img\b/i.test(String(html)) ? '[imagen]' : '');
  }
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const text = (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
  return text || (wrapper.querySelector('img[src]') ? '[imagen]' : '');
}

function isSafeKnowledgeImageSource(value = '') {
  return /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,)/i.test(String(value).trim());
}

const SAFE_KNOWLEDGE_SIZES = new Set(['small', 'normal', 'large', 'xlarge']);

export function sanitizeKnowledgeHtml(html = '') {
  if (!html || typeof DOMParser === 'undefined') return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  const allowedTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'BR', 'HR', 'SPAN', 'IMG']);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!isSafeKnowledgeImageSource(src)) {
        node.remove();
        return;
      }
      [...node.attributes].forEach((attribute) => {
        if (['src', 'alt', 'title', 'width', 'height'].includes(attribute.name.toLowerCase())) return;
        node.removeAttribute(attribute.name);
      });
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      if (!node.getAttribute('alt')) node.setAttribute('alt', 'Imagen del tutorial');
      return;
    }

    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (node.tagName === 'A' && ['href', 'target', 'rel'].includes(name)) return;
      if (node.tagName === 'SPAN' && name === 'data-knowledge-size' && SAFE_KNOWLEDGE_SIZES.has(attribute.value)) return;
      node.removeAttribute(attribute.name);
    });
    if (node.tagName === 'SPAN') {
      const size = node.getAttribute('data-knowledge-size');
      if (size && !SAFE_KNOWLEDGE_SIZES.has(size)) node.removeAttribute('data-knowledge-size');
    }
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
