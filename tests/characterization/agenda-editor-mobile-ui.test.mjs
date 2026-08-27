import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const css = fs.readFileSync(path.join(root, 'src/styles/agenda-editor-mobile.css'), 'utf8');
const indexCss = fs.readFileSync(path.join(root, 'src/styles/index.css'), 'utf8');

assert.match(indexCss, /agenda-editor-mobile\.css/);
assert.match(css, /@media\s*\(max-width:\s*760px\)/);
assert.match(css, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
assert.match(css, /env\(safe-area-inset-top\)/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /font-size:\s*16px/);
assert.match(css, /input\[type='date'\]/);
assert.match(css, /input\[type='time'\]/);
assert.match(css, /@media\s*\(max-width:\s*430px\)/);
assert.match(css, /@media\s*\(max-width:\s*374px\)/);
assert.match(css, /agenda-user-grid/);
assert.match(css, /agenda-editor__footer/);
assert.match(css, /@supports\s*\(-webkit-touch-callout:\s*none\)/);

console.log('✓ agenda editor mobile: iPhone safe-area, viewport, inputs, scroll y acciones responsivas');
