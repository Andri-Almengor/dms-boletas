import { env } from '../config/env.js';
import { sheetsApi } from '../infra/google.js';
import {
  getHeaders,
  invalidateTableCache,
  readTable,
} from '../infra/sheets.repository.js';

const DEVICE_SHEET = 'Evidencia_Mantenimientos';

function clean(value) {
  return String(value ?? '').trim();
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let result = '';
  let value = Number(index) + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export async function propagateEquipmentLocationName({ equipmentLocationId, name, actor = '' }) {
  const id = clean(equipmentLocationId);
  const nextName = clean(name);
  if (!id || !nextName) return { updatedDevices: 0 };

  const [headers, devices] = await Promise.all([
    getHeaders(DEVICE_SHEET),
    readTable(DEVICE_SHEET),
  ]);
  const related = devices.filter((row) => clean(row.UbicacionEquipoID) === id);
  if (!related.length) return { updatedDevices: 0 };

  const timestamp = new Date().toISOString();
  const valuesByHeader = new Map([
    ['Zona', nextName],
    ['UbicacionEquipoNombre', nextName],
    ['ActualizadoPor', actor],
    ['FechaActualizacion', timestamp],
  ]);
  const writable = [...valuesByHeader.entries()].filter(([header]) => headers.includes(header));
  if (!writable.length) return { updatedDevices: 0 };

  const data = [];
  related.forEach((row) => {
    writable.forEach(([header, value]) => {
      const column = columnLetter(headers.indexOf(header));
      data.push({
        range: `${quote(DEVICE_SHEET)}!${column}${row.__rowNumber}`,
        values: [[value]],
      });
    });
  });

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId: env.sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });
  invalidateTableCache(DEVICE_SHEET);
  return { updatedDevices: related.length };
}
