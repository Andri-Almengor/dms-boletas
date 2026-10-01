import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Agenda conserva sync incremental, detalle sincronizado y permisos existentes', () => {
  const page = source('src/pages/agenda/AgendaPage.jsx');

  assert.match(page, /requestSynchronizedCollection/);
  assert.match(page, /requestSynchronizedDetail/);
  assert.match(page, /subscribeSyncResource\('agenda'/);
  assert.match(page, /subscribeSyncEntity\('agenda'/);
  assert.match(page, /hasPermission\('USUARIOS_GESTIONAR'\)/);
  assert.match(page, /AGENDA_LIST_ROUTE = 'agenda\.list'/);
  assert.match(page, /AGENDA_DETAIL_ROUTE = 'agenda\.get'/);
});

test('lista móvil mantiene fechas más recientes primero', () => {
  const page = source('src/pages/agenda/AgendaPage.jsx');

  assert.match(page, /sortAgendaDatesNewestFirst\(grouped\.keys\(\)\)/);
  assert.match(page, /visibleMobileDates\.map/);
  assert.match(page, /className="agenda-mobile-list"/);
});

test('tablet angosta reutiliza la lista cronológica en dos columnas en vez de comprimir siete días', () => {
  const styles = source('src/styles/agenda.css');

  assert.match(styles, /@media \(min-width: 761px\) and \(max-width: 900px\)/);
  assert.match(styles, /\.agenda-calendar\s*\{\s*display:\s*none/s);
  assert.match(styles, /\.agenda-mobile-list\s*\{[^}]*display:\s*grid[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test('escritorio conserva calendario mensual amplio y cuatro eventos visibles antes del diálogo diario', () => {
  const styles = source('src/styles/agenda-calendar-desktop.css');
  const page = source('src/pages/agenda/AgendaPage.jsx');

  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /width:\s*min\(100%, 1780px\)/);
  assert.match(page, /rows\.slice\(0, 4\)/);
  assert.match(page, /rows\.length > 4/);
  assert.match(page, /openDay\(date\)/);
});

test('búsquedas de Agenda son táctiles y accesibles sin cambiar filtrado', () => {
  const page = source('src/pages/agenda/AgendaPage.jsx');
  const styles = source('src/styles/ui-phase3-polish.css');

  assert.match(page, /type="search" value=\{search\}/);
  assert.match(page, /aria-label="Buscar en la agenda"/);
  assert.match(page, /enterKeyHint="search"/);
  assert.match(page, /aria-label="Buscar persona para asignar"/);
  assert.match(page, /normalizeAgendaText\(search\)/);
  assert.match(styles, /\.agenda-search-field--main input\{font-size:16px\}/);
});

test('detalle editor día y separación reutilizan el overlay compartido sin agregar cierres nuevos por Escape', () => {
  const page = source('src/pages/agenda/AgendaPage.jsx');
  const day = source('src/pages/agenda/AgendaDayDialog.jsx');
  const split = source('src/pages/agenda/AgendaSplitDialog.jsx');

  assert.match(page, /useOverlaySurface\(\{ open: Boolean\(item\), onClose, closeOnEscape: false \}\)/);
  assert.match(page, /useOverlaySurface\(\{ open: true, onClose, busy, closeOnEscape: false \}\)/);
  assert.match(day, /useOverlaySurface\(\{ open: Boolean\(date\), onClose, closeOnEscape: false \}\)/);
  assert.match(split, /useOverlaySurface\(\{ open: true, onClose, busy, closeOnEscape: false \}\)/);

  assert.match(page, /apiRequest\('agenda\.update'/);
  assert.match(page, /apiRequest\('agenda\.create'/);
  assert.match(split, /apiRequest\('agenda\.create'/);
  assert.match(split, /apiRequest\('agenda\.update'/);
});

test('detalle y diálogo diario usan viewport dinámico y safe areas en teléfono', () => {
  const agenda = source('src/styles/agenda.css');
  const polish = source('src/styles/ui-phase3-polish.css');

  assert.match(agenda, /\.agenda-detail-sheet\s*\{[^}]*100dvh[^}]*overscroll-behavior:\s*contain/s);
  assert.match(agenda, /\.agenda-detail-sheet \.agenda-sheet-actions\s*\{[^}]*position:\s*sticky[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(polish, /\.agenda-day-dialog\{[^}]*100dvh[^}]*safe-area-inset-top/s);
  assert.match(polish, /\.agenda-day-dialog__list\{[^}]*safe-area-inset-bottom[^}]*overscroll-behavior:contain/s);
});

test('editor móvil mantiene Cancelar visible y apila acciones únicamente en teléfonos muy estrechos', () => {
  const styles = source('src/styles/agenda-editor-mobile.css');

  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.agenda-editor__footer \.button--secondary\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(styles, /@media \(max-width: 374px\)[\s\S]*\.agenda-editor__footer\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styles, /\.agenda-editor__footer \.button--secondary\s*\{[^}]*order:\s*2/s);
  assert.match(styles, /\.agenda-editor__footer \.button--primary\s*\{[^}]*order:\s*1/s);
});

test('separación por persona evita zoom de inputs en móvil y conserva cliente fecha y horario', () => {
  const dialog = source('src/pages/agenda/AgendaSplitDialog.jsx');
  const styles = source('src/styles/agenda-split.css');

  assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.agenda-split-row textarea\{[^}]*font-size:16px/s);
  assert.match(dialog, /fecha: item\.Fecha/);
  assert.match(dialog, /horaInicio: item\.HoraInicio/);
  assert.match(dialog, /horaFin: item\.HoraFin/);
  assert.match(dialog, /clienteId: clean\(item\.ClienteID\)/);
  assert.match(dialog, /clienteNombre: clean\(item\.ClienteNombre\)/);
});
