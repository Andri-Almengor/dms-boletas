import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { app } from '../src/app.js';
import { createInteraction } from '../src/ai/agent.gemini.js';

test('backend health remains available when Gemini credentials are missing', async (t) => {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      createInteraction({ model: 'gemini-test-primary', systemInstruction:'test', input:[] }),
      error => error?.code === 'GEMINI_NOT_CONFIGURED' && error?.status === 503,
    );

    const response = await fetch(origin + '/api/health', {cache:'no-store'});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
