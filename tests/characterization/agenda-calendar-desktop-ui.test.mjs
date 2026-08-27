import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const css = fs.readFileSync(path.join(root, 'src/styles/agenda-calendar-desktop.css'), 'utf8');
const indexCss = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/agenda/AgendaPage.jsx'), 'utf8');

assert.match(indexCss, /agenda-calendar-desktop\.css/);
assert.match(css, /\.page\.agenda-page\s*\{/);
assert.match(css, /width:\s*min\(100%,\s*1780px\)/);
assert.match(css, /grid-template-columns:\s*repeat\(7,minmax\(0,1fr\)\)|agenda-calendar-day/);
assert.match(css, /agenda-event-card--compact/);
assert.match(css, /grid-template-areas/);
assert.match(css, /agenda-event-card__people/);
assert.match(css, /:has\(\.agenda-status--success\)/);
assert.match(css, /agenda-more-events/);
assert.match(css, /@media\s*\(min-width:\s*761px\)/);
assert.match(page, /rows\.slice\(0,\s*4\)/);
assert.match(page, /rows\.length\s*>\s*4/);
assert.match(page, /\+\{rows\.length\s*-\s*4\}\s*más/);

console.log('✓ agenda calendario desktop: ancho ampliado, tarjetas compactas, estados y múltiples agendas por día');
