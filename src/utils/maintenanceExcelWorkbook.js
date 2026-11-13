// XLSX mínimo para la plantilla de dispositivos: usa APIs nativas y funciona sin conexión.
// No introduce dependencias ni cambia el backend o sus reglas de creación.
const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + n % 26) + name;
    n = Math.floor(n / 26);
  }
  return name;
}

function columnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/)?.[0] || '';
  return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zipStored(entries) {
  const chunks = [];
  const centers = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(entries)) {
    const filename = encoder.encode(name);
    const bytes = encoder.encode(xml);
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + filename.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, filename.length, true);
    local.set(filename, 30);
    chunks.push(local, bytes);

    const central = new Uint8Array(46 + filename.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, filename.length, true);
    centralView.setUint32(42, offset, true);
    central.set(filename, 46);
    centers.push(central);
    offset += local.length + bytes.length;
  }
  const centerSize = centers.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centers.length, true);
  endView.setUint16(10, centers.length, true);
  endView.setUint32(12, centerSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...chunks, ...centers, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function worksheetXml(rows) {
  const body = rows.map((row, index) =>
    '<row r="' + (index + 1) + '">' + row.map((value, col) => {
      if (value === null || value === undefined || value === '') return '';
      return '<c r="' + columnName(col) + (index + 1) + '" t="inlineStr"'
        + (index === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">'
        + escapeXml(value) + '</t></is></c>';
    }).join('') + '</row>',
  ).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="17"/>'
    + '<cols><col min="1" max="2" width="26" customWidth="1"/><col min="3" max="100" width="23" customWidth="1"/></cols>'
    + '<sheetData>' + body + '</sheetData></worksheet>';
}

export function createDeviceExcelWorkbook(sheets) {
  const work = sheets.map((sheet, index) =>
    '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' + (index + 1)
    + '" r:id="rId' + (index + 1) + '"/>').join('');
  const types = sheets.map((_, index) =>
    '<Override PartName="/xl/worksheets/sheet' + (index + 1)
    + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  const relationships = sheets.map((_, index) =>
    '<Relationship Id="rId' + (index + 1)
    + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'
    + (index + 1) + '.xml"/>').join('');
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + types + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>' + work + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + relationships + '<Relationship Id="rIdStyles" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB90D19"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>'
      + '</styleSheet>',
  };
  sheets.forEach((sheet, index) => {
    entries['xl/worksheets/sheet' + (index + 1) + '.xml'] = worksheetXml(sheet.rows);
  });
  return zipStored(entries);
}

async function readZipEntry(bytes, entryName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
    if (u32(view, pos) === 0x06054b50) { end = pos; break; }
  }
  if (end < 0) throw new Error('El archivo no es un XLSX válido.');
  const entriesCount = u16(view, end + 10);
  if (entriesCount > 5000) throw new Error('El Excel contiene demasiados archivos internos.');
  let cursor = u32(view, end + 16);
  for (let index = 0; index < entriesCount; index++) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error('La estructura del Excel está dañada.');
    const compression = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const size = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const offset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (size > 8 * 1024 * 1024 || compressedSize > 8 * 1024 * 1024) {
      throw new Error('La hoja del Excel supera el límite de 8 MB.');
    }
    if (u32(view, offset) !== 0x04034b50) throw new Error('La hoja del Excel está dañada.');
    const dataOffset = offset + 30 + u16(view, offset + 26) + u16(view, offset + 28);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    if (compression === 0) return decoder.decode(compressed);
    if (compression === 8 && typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return decoder.decode(await new Response(stream).arrayBuffer());
    }
    throw new Error('Su navegador no admite la compresión de este Excel. Use una versión actualizada de Chrome o Edge.');
  }
  return null;
}

function parseXml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('El Excel contiene XML inválido.');
  return xml;
}

export async function readDeviceExcelWorkbook(file) {
  if (!/\.xlsx$/i.test(file?.name || '')) throw new Error('Seleccione un archivo .xlsx (Excel).');
  if (file.size > 5 * 1024 * 1024) throw new Error('El Excel no debe superar los 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sheet = await readZipEntry(bytes, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('No se encontró la hoja Dispositivos en la primera pestaña.');
  const shared = await readZipEntry(bytes, 'xl/sharedStrings.xml');
  const strings = shared
    ? [...parseXml(shared).getElementsByTagName('si')].map((item) =>
      [...item.getElementsByTagName('t')].map((t) => t.textContent || '').join(''))
    : [];
  const xml = parseXml(sheet);
  const rows = [...xml.getElementsByTagName('row')].map((row) => {
    const cells = [];
    [...row.getElementsByTagName('c')].forEach((cell) => {
      const col = columnIndex(cell.getAttribute('r'));
      if (col < 0 || col > 300) return;
      const type = cell.getAttribute('t');
      const value = type === 'inlineStr'
        ? [...cell.getElementsByTagName('t')].map((t) => t.textContent || '').join('')
        : cell.getElementsByTagName('v')[0]?.textContent || '';
      cells[col] = type === 's' ? strings[Number(value)] ?? '' : value;
    });
    return cells;
  });
  if (!rows.length) throw new Error('La hoja Dispositivos está vacía.');
  const headers = rows[0].map((value) => String(value || '').trim());
  if (!headers.includes('NombreDispositivo') || !headers.includes('UbicacionEquipoID')) {
    throw new Error('Encabezados incompatibles. Descargue la plantilla desde el mantenimiento.');
  }
  return { headers, rows: rows.slice(1).filter((row) => row.some((value) => String(value ?? '').trim())) };
}
