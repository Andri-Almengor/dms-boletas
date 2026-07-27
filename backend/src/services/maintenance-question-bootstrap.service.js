import { nowIso, pick, uuid } from '../core/utils.js';
import { appendRows, readTable } from '../infra/sheets.repository.js';
import {
  MAINTENANCE_QUESTION_SHEET,
  cleanMaintenanceQuestionValue,
  ensureMaintenanceQuestionCatalog,
  legacyMaintenanceQuestions,
} from './maintenance-question-catalog.service.js';

let bootstrapTail = Promise.resolve();
let checked = false;

function withBootstrapLock(operation) {
  const current = bootstrapTail.then(operation, operation);
  bootstrapTail = current.catch(() => {});
  return current;
}

export async function ensureMaintenanceQuestionsReady(actor = 'SYSTEM', { force = false } = {}) {
  await ensureMaintenanceQuestionCatalog(actor);
  if (checked && !force) return { appended: 0 };

  return withBootstrapLock(async () => {
    if (checked && !force) return { appended: 0 };
    const [deviceTypes, existingQuestions] = await Promise.all([
      readTable('TiposDispositivo', { force: true }),
      readTable(MAINTENANCE_QUESTION_SHEET, { force: true }),
    ]);
    const existingKeys = new Set(existingQuestions.map((row) => (
      `${cleanMaintenanceQuestionValue(row.TipoDispositivoID)}|${cleanMaintenanceQuestionValue(row.Clave)}`
    )));
    const timestamp = nowIso();
    const missing = [];

    for (const type of deviceTypes) {
      const typeId = cleanMaintenanceQuestionValue(pick(type, ['TipoDispositivoID', 'id']));
      const typeName = cleanMaintenanceQuestionValue(pick(type, ['Nombre', 'TipoDispositivo']));
      if (!typeId || !typeName) continue;
      for (const question of legacyMaintenanceQuestions(typeName)) {
        const pair = `${typeId}|${cleanMaintenanceQuestionValue(question.Clave)}`;
        if (existingKeys.has(pair)) continue;
        existingKeys.add(pair);
        missing.push({
          PreguntaDispositivoID: uuid(),
          TipoDispositivoID: typeId,
          Clave: question.Clave,
          Pregunta: question.Pregunta,
          Orden: question.Orden,
          TipoRespuesta: 'SI_NO',
          Activo: true,
          Estado: 'ACTIVO',
          CreadoPor: actor,
          FechaCreacion: timestamp,
          ActualizadoPor: actor,
          FechaActualizacion: timestamp,
        });
      }
    }

    if (missing.length) await appendRows(MAINTENANCE_QUESTION_SHEET, missing, { chunkSize: 200 });
    checked = true;
    return { appended: missing.length };
  });
}
