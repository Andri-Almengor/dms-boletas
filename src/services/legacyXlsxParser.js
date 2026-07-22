const UTF8 = new TextDecoder('utf-8');

function clean(value) {
  return String(value ?? '').trim();
}

function normalizePath(path) {
  const output = [];
  String(path || '').replace(/^\//, '').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') output.pop();
    else output.push(part);
  });
  return output.join('/');
}

function resolveTarget(ownerPath, target) {
  if (String(target || '').startsWith('/')) return normalizePath(target);
  const base = ownerPath.split('/').slice(0, -1).join('/');
  return normalizePath(`${base}/${target}`);
}

function findEocd(view) {
  const minimum = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('El archivo no tiene una estructura XLSX válida.');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no permite leer archivos XLSX. Utilice una versión reciente de Chrome o Edge.');
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('No fue posible descomprimir el archivo XLSX. Utilice Chrome o Edge actualizado.');
  }
}

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEocd(view);
  const entriesCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < entriesCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('El directorio del XLSX está dañado.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const fileNameBytes = bytes.slice(cursor + 46, cursor + 46 + fileNameLength);
    const fileName = UTF8.decode(fileNameBytes);

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('El contenido del XLSX está dañado.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRaw(compressed);
    else throw new Error(`El XLSX usa un método de compresión no compatible (${method}).`);

    entries.set(normalizePath(fileName), content);
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if ((flags & 0x0800) === 0 && !fileName) throw new Error('El XLSX contiene una entrada sin nombre.');
  }
  return entries;
}

function xml(entries, path, required = true) {
  const bytes = entries.get(normalizePath(path));
  if (!bytes) {
    if (!required) return null;
    throw new Error(`No se encontró ${path} dentro del archivo XLSX.`);
  }
  const document = new DOMParser().parseFromString(UTF8.decode(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error(`No fue posible interpretar ${path}.`);
  return document;
}

function relationships(document, ownerPath) {
  const map = new Map();
  if (!document) return map;
  [...document.getElementsByTagName('Relationship')].forEach((node) => {
    const id = node.getAttribute('Id');
    const target = node.getAttribute('Target');
    if (id && target) map.set(id, {
      target: node.getAttribute('TargetMode') === 'External' ? target : resolveTarget(ownerPath, target),
      external: node.getAttribute('TargetMode') === 'External',
    });
  });
  return map;
}

function sharedStrings(document) {
  if (!document) return [];
  return [...document.getElementsByTagName('si')].map((node) => (
    [...node.getElementsByTagName('t')].map((text) => text.textContent || '').join('')
  ));
}

function columnIndex(reference) {
  const letters = String(reference || '').match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let result = 0;
  for (const letter of letters) result = (result * 26) + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function columnLetters(index) {
  let result = '';
  let value = Number(index) + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || 'A';
}

function sheetRelationshipsPath(sheetPath) {
  const parts = sheetPath.split('/');
  const fileName = parts.pop();
  return `${parts.join('/')}/_rels/${fileName}.rels`;
}

function readSheet(entries, sheetPath, strings) {
  const document = xml(entries, sheetPath);
  const relDocument = xml(entries, sheetRelationshipsPath(sheetPath), false);
  const rels = relationships(relDocument, sheetPath);
  const hyperlinkMap = new Map();
  [...document.getElementsByTagName('hyperlink')].forEach((node) => {
    const ref = node.getAttribute('ref');
    const relationshipId = node.getAttribute('r:id') || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const location = node.getAttribute('location');
    const relationship = relationshipId ? rels.get(relationshipId) : null;
    if (ref && (relationship?.target || location)) hyperlinkMap.set(ref, relationship?.target || location);
  });

  const rows = [...document.getElementsByTagName('row')].map((rowNode, rowIndex) => {
    const rowNumber = Number(rowNode.getAttribute('r') || rowIndex + 1);
    const values = [];
    [...rowNode.getElementsByTagName('c')].forEach((cell) => {
      const reference = cell.getAttribute('r') || `A${rowNumber}`;
      const type = cell.getAttribute('t') || '';
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      let value = raw;
      if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = [...cell.getElementsByTagName('t')].map((node) => node.textContent || '').join('');
      else if (type === 'b') value = raw === '1';
      else if (!type && raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
      values[columnIndex(reference)] = value;
    });
    return { rowNumber, values };
  }).filter((row) => row.values.some((value) => value !== '' && value !== null && value !== undefined));

  return { rows, hyperlinks: hyperlinkMap };
}

function workbookSheets(entries) {
  const workbookPath = 'xl/workbook.xml';
  const workbook = xml(entries, workbookPath);
  const rels = relationships(xml(entries, 'xl/_rels/workbook.xml.rels'), workbookPath);
  return [...workbook.getElementsByTagName('sheet')].map((node) => {
    const relationshipId = node.getAttribute('r:id') || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    return {
      name: clean(node.getAttribute('name')),
      path: rels.get(relationshipId)?.target || '',
    };
  }).filter((sheet) => sheet.name && sheet.path);
}

function excelDate(value) {
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const text = clean(value);
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function excelTime(value) {
  if (typeof value === 'number') {
    const seconds = Math.round((value % 1) * 86400);
    return `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
  }
  const text = clean(value);
  if (!text) return '';
  const twelve = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (twelve[3].toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${twelve[2]}`;
  }
  const twentyFour = text.match(/^(\d{1,2}):(\d{2})/);
  return twentyFour ? `${String(Number(twentyFour[1])).padStart(2, '0')}:${twentyFour[2]}` : text;
}

function urlValue(value, hyperlink = '') {
  const linked = clean(hyperlink);
  if (/^https?:\/\//i.test(linked)) return linked;
  const text = clean(value);
  return /^https?:\/\//i.test(text) ? text : '';
}

function normalizeHeader(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function headerMap(row) {
  const map = new Map();
  row.values.forEach((value, index) => {
    const key = normalizeHeader(value);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function headerIndex(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.get(normalizeHeader(alias));
    if (index !== undefined) return index;
  }
  return -1;
}

function valueByHeader(row, headers, aliases) {
  const index = headerIndex(headers, aliases);
  return index < 0 ? '' : row.values[index] ?? '';
}

function linkByHeader(row, headers, hyperlinks, aliases) {
  const index = headerIndex(headers, aliases);
  if (index < 0) return '';
  return hyperlinks.get(`${columnLetters(index)}${row.rowNumber}`) || '';
}

function stableHash(value) {
  let result = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function looksLikeHeader(row) {
  const values = new Set(row.values.map(normalizeHeader).filter(Boolean));
  return values.has('boletauid')
    || values.has('id')
    || values.has('titulo')
    || (values.has('cliente') && values.has('estado'));
}

function looksLikeClientHeader(row) {
  const values = new Set(row.values.map(normalizeHeader).filter(Boolean));
  return values.has('clientes')
    || values.has('nombredelcontacto')
    || values.has('correoelectronico')
    || values.has('direcciondeenvio');
}

function mapLegacyTicketPositional(row, hyperlinks) {
  const cell = (index) => row.values[index] ?? '';
  const link = (column) => hyperlinks.get(`${column}${row.rowNumber}`) || '';
  const legacyNumber = Number(cell(1));
  return {
    sourceRow: row.rowNumber,
    legacyUid: clean(cell(0)),
    legacyNumber: Number.isFinite(legacyNumber) ? legacyNumber : null,
    title: clean(cell(2)),
    status: clean(cell(3)),
    reason: clean(cell(4)),
    creatorText: '',
    assignedText: clean(cell(5)),
    legacyClientRef: clean(cell(6)),
    clientName: clean(cell(7)),
    date: excelDate(cell(8)),
    category: clean(cell(9)),
    signatureUrl: urlValue(cell(10), link('K')),
    signatureLabel: clean(cell(10)),
    result: clean(cell(11)),
    totalHours: Number.isFinite(Number(cell(12))) ? Number(cell(12)) : 0,
    startTime: excelTime(cell(13)),
    endTime: excelTime(cell(14)),
    location: clean(cell(15)),
    manufacturer: clean(cell(16)),
    model: clean(cell(17)),
    serial: clean(cell(18)),
    supervisor: clean(cell(19)),
    tests: clean(cell(20)),
    recommendations: clean(cell(21)),
    description: clean(cell(22)),
    equipmentLocation: clean(cell(23)),
    documentUrl: urlValue(cell(24), link('Y')),
    pdfUrl: urlValue(cell(25), link('Z')),
    clientEmail: clean(cell(26)),
    failureType: clean(cell(27)),
    evidenceRefs: clean(cell(28)),
  };
}

function mapHeaderTicket(row, headers, hyperlinks) {
  const legacyNumberValue = valueByHeader(row, headers, ['ID', 'BoletaID', 'Número', 'Numero']);
  const legacyNumber = Number(legacyNumberValue);
  const title = clean(valueByHeader(row, headers, ['Título', 'Titulo']));
  const clientName = clean(valueByHeader(row, headers, ['Cliente', 'Clientes']));
  const date = excelDate(valueByHeader(row, headers, ['Fecha']));
  const creatorText = clean(valueByHeader(row, headers, ['Creador', 'Creado por', 'CreadoPor']));
  const explicitUid = clean(valueByHeader(row, headers, ['BoletaUID', 'UID', 'Row ID', 'RowID']));
  const stableUid = `depurada:${Number.isFinite(legacyNumber) ? legacyNumber : row.rowNumber}:${stableHash(`${title}|${clientName}|${date}|${creatorText}`)}`;
  const signatureValue = valueByHeader(row, headers, ['Firma', 'FirmaURL', 'Firma URL']);
  const documentValue = valueByHeader(row, headers, ['DocumentoURL', 'Documento URL', 'Documento']);
  const pdfValue = valueByHeader(row, headers, ['PDFURL', 'PDF URL', 'PDF']);

  return {
    sourceRow: row.rowNumber,
    legacyUid: explicitUid || stableUid,
    legacyNumber: Number.isFinite(legacyNumber) ? legacyNumber : null,
    title,
    status: clean(valueByHeader(row, headers, ['Estado'])),
    reason: clean(valueByHeader(row, headers, ['Razon_visita', 'Razón_visita', 'Razon visita', 'Razón de visita'])),
    creatorText,
    assignedText: clean(valueByHeader(row, headers, ['AsignadoA', 'Asignado a', 'Técnicos', 'Tecnicos'])),
    legacyClientRef: clean(valueByHeader(row, headers, ['ClienteRef', 'Cliente Ref', 'ClienteID'])),
    clientName,
    date,
    category: clean(valueByHeader(row, headers, ['Categoría', 'Categoria'])),
    signatureUrl: urlValue(signatureValue, linkByHeader(row, headers, hyperlinks, ['Firma', 'FirmaURL', 'Firma URL'])),
    signatureLabel: clean(signatureValue),
    result: clean(valueByHeader(row, headers, ['Resultado'])),
    totalHours: Number.isFinite(Number(valueByHeader(row, headers, ['HorasTotales', 'Horas Totales'])))
      ? Number(valueByHeader(row, headers, ['HorasTotales', 'Horas Totales']))
      : 0,
    startTime: excelTime(valueByHeader(row, headers, ['Hora de inicio', 'HoraInicio', 'Hora inicio'])),
    endTime: excelTime(valueByHeader(row, headers, ['Hora de Finalización', 'Hora de Finalizacion', 'HoraFinal', 'Hora final'])),
    location: clean(valueByHeader(row, headers, ['Ubicación', 'Ubicacion'])),
    manufacturer: clean(valueByHeader(row, headers, ['Fabricante'])),
    model: clean(valueByHeader(row, headers, ['Modelo'])),
    serial: clean(valueByHeader(row, headers, ['Serie'])),
    supervisor: clean(valueByHeader(row, headers, ['Supervisor'])),
    tests: clean(valueByHeader(row, headers, ['Pruebas realizadas', 'PruebasRealizadas'])),
    recommendations: clean(valueByHeader(row, headers, ['Recomendaciones'])),
    description: clean(valueByHeader(row, headers, ['Descripción', 'Descripcion'])),
    equipmentLocation: clean(valueByHeader(row, headers, ['Ubicacion_equipo', 'Ubicación_equipo', 'Ubicacion equipo'])),
    documentUrl: urlValue(documentValue, linkByHeader(row, headers, hyperlinks, ['DocumentoURL', 'Documento URL', 'Documento'])),
    pdfUrl: urlValue(pdfValue, linkByHeader(row, headers, hyperlinks, ['PDFURL', 'PDF URL', 'PDF'])),
    clientEmail: clean(valueByHeader(row, headers, ['Correo_Cliente', 'Correo Cliente', 'CorreoCliente'])),
    failureType: clean(valueByHeader(row, headers, ['Tipo de falla', 'TipoFalla'])),
    evidenceRefs: clean(valueByHeader(row, headers, ['Evidencias', 'EvidenciasLegacy', 'Related Evidencias'])),
  };
}

function mapClientPositional(row) {
  return {
    sourceRow: row.rowNumber,
    name: clean(row.values[0]),
    contact: clean(row.values[1]),
    phone: clean(row.values[2]),
    email: clean(row.values[3]),
    address: clean(row.values[4]),
  };
}

function mapHeaderClient(row, headers) {
  return {
    sourceRow: row.rowNumber,
    name: clean(valueByHeader(row, headers, ['Clientes', 'Cliente', 'Nombre', 'Razón Social', 'RazonSocial'])),
    contact: clean(valueByHeader(row, headers, ['Nombre del contacto', 'Contacto'])),
    phone: clean(valueByHeader(row, headers, ['Números de teléfono', 'Numeros de telefono', 'Teléfono', 'Telefono'])),
    email: clean(valueByHeader(row, headers, ['Correo electrónico', 'Correo electronico', 'Correo', 'Email'])),
    address: clean(valueByHeader(row, headers, ['Dirección de envío', 'Direccion de envio', 'Dirección', 'Direccion'])),
  };
}

function uniqueTicketUids(tickets) {
  const used = new Set();
  return tickets.map((ticket) => {
    let uid = ticket.legacyUid;
    if (used.has(uid)) uid = `${uid}:${ticket.sourceRow}`;
    used.add(uid);
    return { ...ticket, legacyUid: uid };
  });
}

async function fileHash(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseLegacyTicketsWorkbook(file) {
  if (!file) throw new Error('Seleccione el archivo XLSX de la aplicación anterior.');
  if (!/\.xlsx$/i.test(file.name || '')) throw new Error('El archivo debe estar en formato .xlsx.');
  if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera el límite de 20 MB.');

  const buffer = await file.arrayBuffer();
  const entries = await unzip(buffer);
  const strings = sharedStrings(xml(entries, 'xl/sharedStrings.xml', false));
  const sheets = workbookSheets(entries);
  const ticketDefinition = sheets.find((sheet) => sheet.name.toLowerCase() === 'boletas');
  if (!ticketDefinition) throw new Error('El archivo no contiene la hoja Boletas.');
  const clientDefinition = sheets.find((sheet) => sheet.name.toLowerCase() === 'clientes');
  const ticketSheet = readSheet(entries, ticketDefinition.path, strings);
  const ticketHeaderRow = ticketSheet.rows[0] && looksLikeHeader(ticketSheet.rows[0]) ? ticketSheet.rows[0] : null;
  const ticketHeaders = ticketHeaderRow ? headerMap(ticketHeaderRow) : null;
  const ticketRows = ticketHeaderRow ? ticketSheet.rows.slice(1) : ticketSheet.rows;
  const mappedTickets = ticketRows.map((row) => (
    ticketHeaders
      ? mapHeaderTicket(row, ticketHeaders, ticketSheet.hyperlinks)
      : mapLegacyTicketPositional(row, ticketSheet.hyperlinks)
  )).filter((ticket) => ticket.legacyUid && ticket.title && ticket.clientName);
  const tickets = uniqueTicketUids(mappedTickets);

  if (!tickets.length) throw new Error('No se encontraron boletas válidas en el archivo.');

  let clients = [];
  if (clientDefinition) {
    const clientSheet = readSheet(entries, clientDefinition.path, strings);
    const clientHeaderRow = clientSheet.rows[0] && looksLikeClientHeader(clientSheet.rows[0]) ? clientSheet.rows[0] : null;
    const clientHeaders = clientHeaderRow ? headerMap(clientHeaderRow) : null;
    const clientRows = clientHeaderRow ? clientSheet.rows.slice(1) : clientSheet.rows;
    clients = clientRows
      .map((row) => (clientHeaders ? mapHeaderClient(row, clientHeaders) : mapClientPositional(row)))
      .filter((client) => client.name);
  }

  const numberCounts = new Map();
  tickets.forEach((ticket) => numberCounts.set(ticket.legacyNumber, (numberCounts.get(ticket.legacyNumber) || 0) + 1));
  const duplicateNumbers = [...numberCounts.entries()]
    .filter(([number, count]) => number !== null && count > 1)
    .map(([number, count]) => ({ number, count }));
  const statuses = tickets.reduce((result, ticket) => {
    const key = ticket.status || 'Sin estado';
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const finiteNumbers = tickets.map((ticket) => ticket.legacyNumber).filter(Number.isFinite);

  return {
    importId: await fileHash(buffer),
    fileName: file.name,
    format: ticketHeaders ? 'DEPURADA_CON_ENCABEZADOS' : 'EXPORTACION_ORIGINAL',
    tickets,
    clients,
    summary: {
      tickets: tickets.length,
      clients: new Set(tickets.map((ticket) => ticket.clientName)).size,
      firstNumber: finiteNumbers.length ? Math.min(...finiteNumbers) : '',
      lastNumber: finiteNumbers.length ? Math.max(...finiteNumbers) : '',
      duplicateNumbers,
      statuses,
      format: ticketHeaders ? 'Depurada con encabezados' : 'Exportación original',
    },
  };
}
