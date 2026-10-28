import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { requestSecurityMiddleware } from '../../backend/src/middleware/security.middleware.js';

test('la respuesta HTTP del asistente permite solicitar micrófono solo al propio origen', async (t) => {
  // Ejercita el middleware real mediante HTTP, no una copia textual de su valor.
  const server = createServer((req, res) => {
    req.get = (name) => req.headers[String(name).toLowerCase()];
    requestSecurityMiddleware(req, res, () => {
      res.statusCode = 200;
      res.setHeader('Content-Type', req.url.startsWith('/api/') ? 'application/json' : 'text/html');
      res.end(req.url.startsWith('/api/') ? '{"ok":true}' : '<!doctype html><title>DMS Assistant</title>');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/asistente?from=%2F', '/api/health']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, `GET ${route}`);
    const policy = response.headers.get('permissions-policy');
    assert.ok(policy, 'cada respuesta debe publicar Permissions-Policy');
    const directives = Object.fromEntries(policy.split(',').map((part) => part.trim().split('=').map((v) => v.trim())));
    assert.equal(directives.microphone, '(self)', 'el propio origen puede pedir permiso al navegador');
    assert.equal(directives.payment, '()', 'pagos permanecen deshabilitados');
    assert.equal(directives.usb, '()', 'USB permanece deshabilitado');
    assert.equal(directives['browsing-topics'], '()', 'browsing-topics permanece deshabilitado');
    assert.doesNotMatch(policy, /microphone=\(\)/, 'se prohíbe regresar al bloqueo original');
  }
});
