import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const css = fs.readFileSync(path.join(root, 'src/styles/agenda-calendar-desktop.css'), 'utf8');
const polishCss = fs.readFileSync(path.join(root, 'src/styles/ui-phase3-polish.css'), 'utf8');
const indexCss = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');
const dayDialog = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaDayDialog.jsx'), 'utf8');
const summary = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaCalendarSummary.jsx'), 'utf8');

assert.match(indexCss, /agenda-calendar-desktop\.css/);
assert.match(indexCss, /ui-phase3-polish\.css/);
assert.match(css, /\.page\.agenda-page\s*\{/);
assert.match(css, /width:\s*min\(100%,\s*1780px\)/);
assert.match(css, /agenda-calendar__weekdays/);
assert.match(css, /agenda-calendar-day/);
assert.match(css, /agenda-event-card--compact/);
assert.match(css, /grid-template-areas/);
assert.match(css, /agenda-event-card__people/);
assert.match(css, /:has\(\.agenda-status--success\)/);
assert.match(css, /agenda-more-events/);
assert.match(css, /@media\s*\(min-width:\s*761px\)/);
assert.match(page, /rows\.slice\(0,\s*4\)/);
assert.match(page, /rows\.length\s*>\s*4/);
assert.match(page, /openDay\(date\)/);
assert.match(page, /AgendaDayDialog/);
assert.match(page, /AgendaCalendarSummary/);
assert.match(page, /Ver las \{rows\.length\} agendas/);
assert.match(dayDialog, /Programación del día/);
assert.match(dayDialog, /ordered\.map/);
assert.match(dayDialog, /statusMeta/);
assert.match(summary, /Agendas del mes/);
assert.match(summary, /Boleta realizada/);
assert.match(summary, /Boleta pendiente/);
assert.match(summary, /Programada/);
assert.match(summary, /No requiere boleta/);
assert.match(polishCss, /agenda-month-summary/);
assert.match(polishCss, /agenda-day-dialog/);
assert.match(polishCss, /notification-panel--chat/);
assert.match(polishCss, /focus-visible/);

console.log('✓ agenda calendario: ancho ampliado, múltiples agendas, resumen mensual, panel diario y pulido final de UX');