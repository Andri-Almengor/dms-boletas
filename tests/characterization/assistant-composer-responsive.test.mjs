import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

test('composer conserva los cuatro controles en el mismo flujo con campo amplio en escritorio', () => {
  const page = source('src/pages/assistant/AssistantPageSecure.jsx');
  const styles = source('src/styles/assistant.css');
  const fullscreen = source('src/styles/assistant-experience.css');

  assert.match(page, /className="assistant-composer__row"[\s\S]*?className="assistant-attach-button"[\s\S]*?assistant-microphone[\s\S]*?<textarea[\s\S]*?type="submit"/);
  assert.match(styles, /\.assistant-composer__row\s*\{[^}]*grid-template-columns:\s*var\(--touch-target-min, 44px\) var\(--touch-target-min, 44px\) minmax\(0, 1fr\) auto/s);
  assert.match(fullscreen, /\.app-shell--assistant \.assistant-composer__row\s*\{[^}]*grid-template-columns:\s*repeat\(2, var\(--touch-target-min, 44px\)\) minmax\(0, 1fr\) auto/s);
});

test('composer móvil usa texto de ancho completo y botones en segunda fila sin ocultar icono Enviar', () => {
  const page = source('src/pages/assistant/AssistantPageSecure.jsx');
  const styles = source('src/styles/assistant.css');
  const fullscreen = source('src/styles/assistant-experience.css');

  for (const css of [styles, fullscreen]) {
    assert.match(css, /\.assistant-composer__row > textarea\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1;/s);
    assert.match(css, /\.assistant-composer__row > \.assistant-microphone\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s);
    assert.match(css, /\.assistant-composer__row > \.button\[type='submit'\]\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*2;/s);
    assert.match(css, /\.assistant-composer \.button > span:not\(\.material-symbols-outlined\)\s*\{[^}]*display:\s*none;/s);
    assert.doesNotMatch(css, /\.assistant-composer \.button span\s*\{\s*display:\s*none;/s);
  }
  assert.match(page, /aria-label="Enviar pregunta"/);
  assert.match(page, /placeholder="Escriba o dicte su mensaje…"/);
  assert.match(page, /!speechSupported && !recordingSupported && 'Para dictar, use el micrófono del teclado/);
});
