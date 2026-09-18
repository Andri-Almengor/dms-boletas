import { inflateRawSync } from 'node:zlib';

function clean(value, max = 500) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function decodeXml(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripXml(value = '') {
  return decodeXml(String(value).replace(/<[^>]*>/g, ''));
}

function parseDelimitedLine(line, delimiter = ',') {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      values.push(clean(current));
      current = '';
      continue;
    }
    current += char;
  }
  values.push(clean(current));
  return values;
}

function delimiterFor(text) {
  const first = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = [
    [',', (first.match(/,/g) || []).length],
    [';', (first.match(/;/g) || []).length],
    ['\t', (first.match(/\t/g) || []).length],
    ['|', (first.match(/\|/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ',';
}

function looksLikeHeader(values = []) {
  const text = values.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(nombre|dispositivo|equipo|tipo|categoria|name|type)\b/.test(text);
}

function splitNameType(line) {
  const value = clean(line, 1000);
  if (!value) return null;
  for (const separator of ['|', '\t', ' — ', ' - ', ' – ', ';']) {
    if (!value.includes(separator)) continue;
    const [name, ...rest] = value.split(separator);
    const type = rest.join(separator);
    if (clean(name) && clean(type)) return { name: clean(name), type: clean(type) };
  }
  return { name: value, type: '' };
}

function rowObjects(rows = []) {
  const normalized = rows
    .map((row) => (Array.isArray(row) ? row.map((value) => clean(value, 1000)) : []))
    .filter((row) => row.some(Boolean));
  if (!normalized.length) return [];

  const start = looksLikeHeader(normalized[0]) ? 1 : 0;
  return normalized.slice(start).map((row) => {
    if (row.length >= 2 && row[0] && row[1]) return { name: clean(row[0]), type: clean(row[1]) };
    return splitNameType(row.find(Boolean) || '');
  }).filter((item) => item?.name);
}

export function parseDeviceText(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = delimiterFor(lines.join('\n'));
  const structured = lines.some((line) => line.includes(delimiter))
    ? rowObjects(lines.map((line) => parseDelimitedLine(line, delimiter)))
    : lines.map(splitNameType).filter(Boolean);
  return structured.map((item, index) => ({
    row: index + 1,
    name: clean(item.name),
    type: clean(item.type),
  }));
}

function findEocd(buffer) {
  const signature = 0x06054b50;
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error('El archivo ZIP no contiene un directorio central válido.');
}

function unzipEntries(buffer, { maxEntryBytes = 12 * 1024 * 1024, maxTotalBytes = 32 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('El documento comprimido está vacío o dañado.');
  const eocd = findEocd(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let totalInflated = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('El documento comprimido tiene un índice inválido.');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (uncompressedSize > maxEntryBytes) throw new Error('El documento contiene una parte demasiado grande para analizar.');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('El documento comprimido contiene una entrada inválida.');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let value;
    if (method === 0) value = Buffer.from(compressed);
    else if (method === 8) value = inflateRawSync(compressed);
    else throw new Error('El documento usa una compresión no compatible.');

    totalInflated += value.length;
    if (totalInflated > maxTotalBytes) throw new Error('El documento expandido supera el límite seguro de análisis.');
    entries.set(name, value);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function sharedStrings(entries) {
  const xml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeXml(item[1]))
      .join(''));
}

function columnIndex(reference = '') {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function workbookRows(entries) {
  const sheetName = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error('El XLSX no contiene hojas de cálculo legibles.');
  const xml = entries.get(sheetName).toString('utf8');
  const strings = sharedStrings(entries);
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br="([^"]+)"/i)?.[1] || '';
      const type = attrs.match(/\bt="([^"]+)"/i)?.[1] || '';
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1]
        ?? body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i)?.[1]
        ?? '';
      let value = decodeXml(raw);
      if (type === 's' && /^\d+$/.test(value)) value = strings[Number(value)] ?? value;
      row[columnIndex(reference)] = clean(value, 1000);
    }
    rows.push(row);
  }
  return rows;
}

export function parseXlsxDevices(buffer) {
  return rowObjects(workbookRows(unzipEntries(buffer))).map((item, index) => ({
    row: index + 1,
    name: clean(item.name),
    type: clean(item.type),
  }));
}

export function parseDocxDevices(buffer) {
  const entries = unzipEntries(buffer);
  const xml = entries.get('word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('El DOCX no contiene un documento legible.');
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_match, value) => decodeXml(value))
    .replace(/<[^>]+>/g, '');
  return parseDeviceText(text);
}

function pdfLiteral(value = '') {
  return String(value)
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\[0-7]{1,3}/g, (match) => String.fromCharCode(parseInt(match.slice(1), 8)));
}

function pdfTextFromStream(stream) {
  const out = [];
  for (const match of String(stream).matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    out.push(pdfLiteral(match[0].replace(/\)\s*Tj$/, '').slice(1)));
  }
  for (const match of String(stream).matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g)) {
    for (const token of match[1].matchAll(/\((?:\\.|[^\\)])*\)/g)) out.push(pdfLiteral(token[0].slice(1, -1)));
  }
  return out.join(' ');
}

export function parsePdfDevices(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    throw new Error('El PDF no tiene una cabecera válida.');
  }
  const raw = buffer.toString('latin1');
  const pieces = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    let data = Buffer.from(match[1], 'latin1');
    const dictionaryStart = raw.lastIndexOf('<<', match.index);
    const dictionary = dictionaryStart >= 0 ? raw.slice(dictionaryStart, match.index) : '';
    if (/\/FlateDecode\b/.test(dictionary)) {
      try { data = inflateRawSync(data); } catch { continue; }
    }
    const value = pdfTextFromStream(data.toString('latin1'));
    if (value) pieces.push(value);
  }
  const fallback = pdfTextFromStream(raw);
  if (fallback) pieces.push(fallback);
  const text = pieces.join('\n').trim();
  if (!text) throw new Error('El PDF no contiene texto extraíble de forma segura.');
  return parseDeviceText(text);
}

export function parseDeviceImportBuffer({ buffer, mimeType = '', fileName = '' }) {
  const name = clean(fileName, 500).toLowerCase();
  const mime = clean(mimeType, 200).toLowerCase();
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || name.endsWith('.xlsx')) {
    return { format: 'XLSX', items: parseXlsxDevices(buffer) };
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    return { format: 'DOCX', items: parseDocxDevices(buffer) };
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return { format: 'PDF', items: parsePdfDevices(buffer) };
  }
  if (mime === 'text/csv' || name.endsWith('.csv')) {
    return { format: 'CSV', items: parseDeviceText(buffer.toString('utf8')) };
  }
  if (mime === 'text/plain' || name.endsWith('.txt')) {
    return { format: 'TXT', items: parseDeviceText(buffer.toString('utf8')) };
  }
  throw new Error('El formato del documento no está habilitado para importación de dispositivos.');
}
