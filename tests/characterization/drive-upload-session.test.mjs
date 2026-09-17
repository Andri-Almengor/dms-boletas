import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { isAuthenticationError } from '../../src/services/requestErrors.js';

const errors = [
  { status: 500, code: 'INTERNAL_ERROR', message: "'get' on proxy: property 'files'" },
  { status: 500, code: 'DRIVE_ERROR' },
  { status: 502 }, { status: 503, code: 'SERVER_BUSY' },
  new TypeError('Failed to fetch'),
  { code: 'SYNC_SECURITY_REFRESH_REQUIRED' },
  { status: 403, code: 'FORBIDDEN' },
  { status: 401, code: 'UNAUTHORIZED' },
];

for (const error of errors) {
  test(`AuthProvider preserves session for ${error.code || error.status || error.message}, except genuine 401`, async () => {
    const cached = { sessionToken: 'fixture-token', user: { UsuarioID: 'U1' }, permissions: ['BOLETAS_VER'] };
    const storage = new Map([['dms_session', JSON.stringify(cached)]]);
    const state = []; let cursor = 0; let effects = []; let captured;
    const fixture = {
      React: { createElement: (_type, props) => { captured = props.value; } },
      createContext: () => ({ Provider: 'provider' }), useContext: () => null, useMemo: (fn) => fn(),
      useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useEffect: (fn) => effects.push(fn),
      localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
      apiRequest: async () => { throw error; }, isAuthenticationError,
      clearSyncSecurityBlock: async () => {}, hasImpliedOperationalClientPermission: () => false,
    };
    globalThis.__driveAuthFixture = fixture;
    const source = readFileSync(new URL('../../src/context/AuthContext.jsx', import.meta.url), 'utf8').replace(/import[^;]+;\n/g, '');
    const { code } = await transform(`const {${Object.keys(fixture)}} = globalThis.__driveAuthFixture;\n${source}`, { loader: 'jsx', format: 'esm' });
    const module = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//' + JSON.stringify(error)).toString('base64')}`);
    module.AuthProvider({ children: null }); effects[0]();
    await new Promise((resolve) => setImmediate(resolve));
    cursor = 0; effects = []; module.AuthProvider({ children: null });
    assert.equal(storage.has('dms_session'), error.status !== 401);
    assert.equal(captured.sessionToken, error.status === 401 ? '' : cached.sessionToken);
  });
}

test('upload idle never initiates a global sync; it only resumes a previously deferred scheduled run', async () => {
  const source = readFileSync(new URL('../../src/services/syncManager.js', import.meta.url), 'utf8');
  const scheduler = source.slice(source.indexOf('function ensureBackgroundScheduler()'), source.indexOf('\nfunction rememberResourceSync'));
  const listeners = new Map(); const reasons = []; let media = false; let tick;
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), setInterval: (fn) => { tick = fn; } };
  const start = new Function('window', 'canRunBackgroundSync', 'isMediaUploadActive', 'syncKnownResourcesInBackground',
    `let backgroundSchedulerStarted = false; const BACKGROUND_SYNC_INTERVAL_MS = 60000; ${scheduler}; return ensureBackgroundScheduler;`)(
    window, () => !media, () => media, async (reason) => reasons.push(reason));
  start();
  for (let image = 0; image < 10; image++) {
    media = true; media = false;
    listeners.get('dms-media-upload-idle')();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, []);
  media = true; tick(); media = false;
  listeners.get('dms-media-upload-idle')();
  listeners.get('dms-media-upload-idle')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ['media-idle']);
  tick(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ['media-idle', 'timer']);
});
