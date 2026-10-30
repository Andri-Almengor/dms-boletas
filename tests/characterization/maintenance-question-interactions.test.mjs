import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  moveMaintenanceQuestionIds,
  toggleMaintenanceQuestionChoice,
} from '../../src/utils/maintenanceQuestionInteractions.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (name) => readFileSync(path.join(ROOT, name), 'utf8');

test('pulsar por segunda vez Sí o No desmarca la respuesta, sin afectar otras opciones', () => {
  assert.equal(toggleMaintenanceQuestionChoice('', 'Sí'), 'Sí');
  assert.equal(toggleMaintenanceQuestionChoice('Sí', 'Sí'), '');
  assert.equal(toggleMaintenanceQuestionChoice('No', 'No'), '');
  assert.equal(toggleMaintenanceQuestionChoice('No', 'Sí'), 'Sí');
  assert.equal(toggleMaintenanceQuestionChoice('Sí', 'No'), 'No');
  assert.equal(toggleMaintenanceQuestionChoice(null, 'No'), 'No');
});

test('mover una pregunta encima de otra mantiene todas sus claves e invierte el orden indicado', () => {
  const original = ['limpieza', 'montaje', 'alimentacion', 'conexion', 'visualizacion', 'cableado'];
  assert.deepEqual(moveMaintenanceQuestionIds(original, 'conexion', 'montaje'),
    ['limpieza', 'conexion', 'montaje', 'alimentacion', 'visualizacion', 'cableado']);
  assert.deepEqual(moveMaintenanceQuestionIds(original, 'limpieza', 'visualizacion'),
    ['montaje', 'alimentacion', 'conexion', 'visualizacion', 'limpieza', 'cableado']);
  assert.deepEqual(moveMaintenanceQuestionIds(original, 'cableado', 'limpieza'),
    ['cableado', 'limpieza', 'montaje', 'alimentacion', 'conexion', 'visualizacion']);
  assert.deepEqual(original, ['limpieza', 'montaje', 'alimentacion', 'conexion', 'visualizacion', 'cableado']);
});

test('arrastre nulo o hacia un ID inexistente no altera el orden ni duplica registros', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveMaintenanceQuestionIds(ids, 'a', 'a'), ids);
  assert.deepEqual(moveMaintenanceQuestionIds(ids, 'inexistente', 'b'), ids);
  assert.deepEqual(moveMaintenanceQuestionIds(ids, 'b', 'inexistente'), ids);
  assert.deepEqual(moveMaintenanceQuestionIds(ids, 'b', 'c'), ['a', 'c', 'b']);
});

test('el toggle se aplica solo a preguntas dinámicas Sí/No, con borrado real de la respuesta', () => {
  const ui = source('src/components/maintenance/MaintenanceQuestionField.jsx');
  assert.match(ui, /if \(type === 'SI_NO'\)/);
  assert.match(ui, /toggleMaintenanceQuestionChoice\(value, option\)/);
  assert.match(ui, /aria-pressed=\{String\(value \?\? ''\) === String\(option\)\}/);
  assert.match(ui, /if \(type === 'OPCIONES'\)/);
  const editor = source('src/components/maintenance/MaintenanceDeviceEditor.jsx');
  assert.match(editor, /allowClear \? toggleMaintenanceQuestionChoice\(value, option\) : option/);
  assert.match(editor, /funcionamiento: value \}\)} disabled=\{checklistLocked\} allowClear/);
  assert.match(editor, /enUso: value \}\)} options=\{\['Sí, en uso', 'No, está guardado', 'No'\]\} disabled=\{checklistLocked\} allowClear/);
  assert.match(editor, /label="Estado"[\s\S]*?disabled=\{checklistLocked \|\| !checklistCompletion\.complete\}/);
});

test('drag usa pointer events para móvil, asa visible y teclado accesible sin guardar cada pixel', () => {
  const admin = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const style = source('src/styles/maintenance-question-cards.css');
  assert.match(admin, /moveMaintenanceQuestionIds\(originalIds, sourceId, targetId\)/);
  assert.match(admin, /onPointerDown=\{\(event\) => onHandlePointerDown\(event, id\)\}/);
  assert.match(admin, /onPointerMove=\{onHandlePointerMove\}/);
  assert.match(admin, /onPointerUp=\{onHandlePointerUp\}/);
  assert.match(admin, /onPointerCancel=\{resetDrag\}/);
  assert.match(admin, /event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'/);
  assert.match(admin, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(admin, /elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(style, /touch-action: none/);
  assert.match(style, /\.maintenance-question-manager__list > article\.is-drop-target/);
});

test('reordenamiento reutiliza el update protegido y es atómico, auditable y compatible con Render multinstancia', () => {
  const admin = source('src/pages/admin/MaintenanceQuestionsPage.jsx');
  const backend = source('backend/src/modules/maintenance-dynamic-questions.module.js');
  const routes = source('backend/src/core/action-router.js');
  assert.match(admin, /requestAvailable\(QUESTION_ROUTES\.update, \{/);
  assert.match(admin, /orderedQuestionIds: orderedIds/);
  assert.match(admin, /expectedQuestionOrder/);
  assert.match(admin, /await load\(\)/);
  assert.match(backend, /if \(!canManageQuestions\(ctx\)\) throw forbidden/);
  assert.match(routes, /maintenance\.questions\.update[\s\S]*maintenanceQuestionHandlers\.update, 'CATALOGOS_GESTIONAR'/);
  assert.match(backend, /pg_advisory_xact_lock/);
  assert.match(backend, /withTransaction\(/);
  assert.match(backend, /FOR UPDATE/);
  assert.match(backend, /FROM UNNEST\(\$1::text\[\], \$2::text\[\]\)/);
  assert.match(backend, /updated\.rowCount !== rows\.length/);
  assert.match(backend, /Otro administrador cambió las preguntas/);
  assert.match(backend, /REORDENAR_PREGUNTAS_MANTENIMIENTO/);
});
