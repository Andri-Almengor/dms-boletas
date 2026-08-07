import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { MilestoneAdapter } from '../../gateway-agent/src/adapters/milestone.adapter.js';
import { createAdapterFromEnvironment } from '../../gateway-agent/src/adapters/adapter-factory.js';
import { normalizeInventoryItem } from '../../backend/src/services/integration-gateway.domain.js';

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function createMilestoneMock() {
  const counters = { auth: 0, cameras: 0, hardware: 0, recordingServers: 0 };
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push(`${request.method} ${url.pathname}${url.search}`);

    if (request.method === 'GET' && url.pathname === '/api/.well-known/uris') {
      sendJson(response, 200, { apiGateway: 'mock' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/API/IDP/connect/token') {
      counters.auth += 1;
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const form = new URLSearchParams(body);
        if (
          form.get('grant_type') !== 'password'
          || form.get('client_id') !== 'GrantValidatorClient'
          || form.get('username') !== 'dms-inventory'
          || form.get('password') !== 'local-secret'
        ) {
          sendJson(response, 401, { error: 'invalid_grant' });
          return;
        }
        sendJson(response, 200, { access_token: 'mock-token', expires_in: 600 });
      });
      return;
    }

    if (request.headers.authorization !== 'Bearer mock-token') {
      sendJson(response, 401, { error: { message: 'missing bearer' } });
      return;
    }

    if (url.pathname === '/api/rest/v1/sites') {
      sendJson(response, 200, {
        array: [{ id: 'site-1', displayName: 'DMS XProtect Lab' }],
      });
      return;
    }

    if (url.pathname === '/api/rest/v1/cameras') {
      counters.cameras += 1;
      sendJson(response, 200, {
        array: [
          {
            id: 'camera-1',
            displayName: 'Entrada principal',
            enabled: true,
            channel: 0,
            lastModified: '2026-08-07T10:00:00Z',
            relations: { parent: { type: 'hardware', id: 'hardware-1' } },
          },
          {
            id: 'camera-2',
            displayName: 'Parqueo',
            enabled: false,
            channel: 1,
            relations: { parent: { type: 'hardware', id: 'hardware-2' } },
          },
        ],
      });
      return;
    }

    if (url.pathname === '/api/rest/v1/hardware') {
      counters.hardware += 1;
      sendJson(response, 200, {
        array: [
          {
            id: 'hardware-1',
            displayName: 'AXIS P3265-LV (192.168.20.50)',
            address: 'https://root:never-export-this@192.168.20.50:443/device/path',
            userName: 'root',
            password: 'never-export-this',
            model: 'AXIS P3265-LV',
            enabled: true,
            relations: { parent: { type: 'recordingServers', id: 'rec-1' } },
          },
          {
            id: 'hardware-2',
            displayName: 'Test Camera 2',
            address: 'http://192.168.20.51/',
            model: 'Virtual model',
            enabled: true,
            relations: { parent: { type: 'recordingServers', id: 'rec-1' } },
          },
        ],
      });
      return;
    }

    if (url.pathname === '/api/rest/v1/recordingServers') {
      counters.recordingServers += 1;
      sendJson(response, 200, {
        array: [{ id: 'rec-1', displayName: 'Recording Server 01' }],
      });
      return;
    }

    sendJson(response, 404, { error: { message: 'not found' } });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    counters,
    requests,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('MilestoneAdapter autentica, pagina y normaliza cámaras sin exportar credenciales', async () => {
  const mock = await createMilestoneMock();
  try {
    const adapter = new MilestoneAdapter({
      baseUrl: mock.baseUrl,
      username: 'dms-inventory',
      password: 'local-secret',
      allowHttp: true,
      pageSize: 100,
    });

    const connection = await adapter.testConnection();
    assert.equal(connection.ok, true);
    assert.equal(connection.siteName, 'DMS XProtect Lab');

    const devices = await adapter.listDevices();
    assert.equal(devices.length, 2);
    assert.equal(mock.counters.auth, 1, 'el bearer token debe reutilizarse mientras sea válido');
    assert.equal(mock.counters.cameras, 1);
    assert.equal(mock.counters.hardware, 1);
    assert.equal(mock.counters.recordingServers, 1);

    const first = devices[0];
    assert.equal(first.externalId, 'camera-1');
    assert.equal(first.sourceSystem, 'MILESTONE');
    assert.equal(first.name, 'Entrada principal');
    assert.equal(first.ipAddress, '192.168.20.50');
    assert.equal(first.model, 'AXIS P3265-LV');
    assert.equal(first.status, 'CONFIGURED');
    assert.equal(first.connectionVerified, false);
    assert.equal(first.metadata.hardwareAddress, 'https://192.168.20.50');
    assert.equal(first.metadata.recordingServerName, 'Recording Server 01');
    assert.doesNotMatch(JSON.stringify(first), /root|never-export-this|local-secret|mock-token/);

    assert.equal(devices[1].status, 'DISABLED');

    const normalized = normalizeInventoryItem(first, {
      GatewayID: 'gateway-milestone',
      ClienteID: 'cliente-1',
    });
    assert.equal(normalized.SourceSystem, 'MILESTONE');
    assert.equal(normalized.EstadoConexion, 'CONFIGURED');
    assert.equal(normalized.UltimaConexion, '');
    assert.doesNotMatch(normalized.MetadataJSON, /root|never-export-this|local-secret|mock-token/);

    assert.ok(mock.requests.some((value) => value.includes('/cameras?page=0&size=100&disabled')));
  } finally {
    await mock.close();
  }
});

test('la fábrica exige HTTPS de Milestone salvo habilitación explícita de laboratorio', () => {
  const base = {
    DMS_GATEWAY_ADAPTER: 'milestone',
    DMS_MILESTONE_URL: 'http://192.168.1.20',
    DMS_MILESTONE_USERNAME: 'reader',
    DMS_MILESTONE_PASSWORD: 'secret',
  };

  assert.throws(
    () => createAdapterFromEnvironment(base),
    /DMS_MILESTONE_ALLOW_HTTP=true/,
  );

  const adapter = createAdapterFromEnvironment({
    ...base,
    DMS_MILESTONE_ALLOW_HTTP: 'true',
  });
  assert.equal(adapter.name, 'MILESTONE');
});
