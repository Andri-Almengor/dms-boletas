import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_DEVICES = 2_500;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  return fallback;
}

function normalizedBaseUrl(value, allowHttp) {
  let url;
  try {
    url = new URL(text(value));
  } catch {
    throw new Error('DMS_MILESTONE_URL no es una URL válida.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('DMS_MILESTONE_URL debe utilizar http:// o https://.');
  }
  if (url.protocol === 'http:' && !allowHttp) {
    throw new Error(
      'DMS_MILESTONE_URL usa HTTP. Configure HTTPS o habilite DMS_MILESTONE_ALLOW_HTTP=true solo para laboratorio.',
    );
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function safeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    return url.origin;
  } catch {
    return '';
  }
}

function hostFromAddress(value) {
  if (!value) return '';
  try {
    return new URL(String(value)).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

function relationId(item, relationName) {
  return text(item?.relations?.[relationName]?.id);
}

function responseError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function errorDetail(data) {
  const candidate = data?.error_description
    || data?.error?.message
    || data?.error
    || data?.message
    || '';
  return text(candidate).slice(0, 300);
}

function loadCaFile(caFile) {
  const requested = text(caFile);
  if (!requested) return undefined;
  const resolved = path.resolve(process.cwd(), requested);
  try {
    return readFileSync(resolved);
  } catch (error) {
    throw new Error(`No fue posible leer DMS_MILESTONE_CA_FILE (${resolved}): ${error.message}`);
  }
}

function requestJson(url, {
  method = 'GET',
  headers = {},
  body = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowInsecureTls = false,
  ca,
} = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      method,
      headers,
    };
    if (url.protocol === 'https:') {
      options.rejectUnauthorized = !allowInsecureTls;
      if (ca) options.ca = ca;
    }

    const request = transport.request(url, options, (response) => {
      const chunks = [];
      let received = 0;

      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          request.destroy(responseError(
            'La respuesta de Milestone superó el límite de 20 MB.',
            'MILESTONE_RESPONSE_TOO_LARGE',
            response.statusCode || 0,
          ));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          data,
          raw,
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(responseError(
        `Milestone no respondió en ${timeoutMs} ms.`,
        'MILESTONE_TIMEOUT',
      ));
    });
    request.on('error', (error) => {
      if (!error.code || !String(error.code).startsWith('MILESTONE_')) {
        error.code = error.code || 'MILESTONE_NETWORK_ERROR';
      }
      reject(error);
    });

    if (body) request.write(body);
    request.end();
  });
}

export class MilestoneAdapter {
  constructor({
    baseUrl,
    username,
    password,
    allowHttp = false,
    allowInsecureTls = false,
    caFile = '',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pageSize = DEFAULT_PAGE_SIZE,
    maxDevices = DEFAULT_MAX_DEVICES,
  } = {}) {
    this.name = 'MILESTONE';
    this.allowHttp = Boolean(allowHttp);
    this.allowInsecureTls = Boolean(allowInsecureTls);
    this.baseUrl = normalizedBaseUrl(baseUrl, this.allowHttp);
    this.username = text(username);
    this.password = text(password);
    if (!this.username) throw new Error('Falta DMS_MILESTONE_USERNAME.');
    if (!this.password) throw new Error('Falta DMS_MILESTONE_PASSWORD.');

    this.timeoutMs = boundedNumber(timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 120_000);
    this.pageSize = boundedNumber(pageSize, DEFAULT_PAGE_SIZE, 10, 250);
    this.maxDevices = boundedNumber(maxDevices, DEFAULT_MAX_DEVICES, 1, DEFAULT_MAX_DEVICES);
    this.ca = loadCaFile(caFile);
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
  }

  capabilities() {
    return {
      inventory: true,
      heartbeat: true,
      commands: ['PING', 'INVENTORY_SYNC'],
      snapshots: false,
      liveVideo: false,
      liveStatus: false,
      configurationApi: true,
      sourceSystems: ['MILESTONE'],
    };
  }

  endpoint(relativePath) {
    return new URL(relativePath, `${this.baseUrl}/`);
  }

  async rawRequest(relativePath, options = {}) {
    return requestJson(this.endpoint(relativePath), {
      timeoutMs: this.timeoutMs,
      allowInsecureTls: this.allowInsecureTls,
      ca: this.ca,
      ...options,
    });
  }

  async authenticate({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.accessToken && now < this.accessTokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const form = new URLSearchParams({
      grant_type: 'password',
      username: this.username,
      password: this.password,
      client_id: 'GrantValidatorClient',
    }).toString();
    const response = await this.rawRequest('/API/IDP/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form),
        'Accept': 'application/json',
      },
      body: form,
    });

    if (response.status !== 200 || !response.data?.access_token) {
      const detail = errorDetail(response.data);
      throw responseError(
        `Milestone rechazó la autenticación${detail ? `: ${detail}` : ` (HTTP ${response.status})`}.`,
        'MILESTONE_AUTH_FAILED',
        response.status,
      );
    }

    this.accessToken = String(response.data.access_token);
    const expiresInSeconds = boundedNumber(response.data.expires_in, 300, 30, 86_400);
    this.accessTokenExpiresAt = now + expiresInSeconds * 1_000;
    return this.accessToken;
  }

  async apiGet(relativePath, { retryAuth = true } = {}) {
    const token = await this.authenticate();
    const response = await this.rawRequest(relativePath, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (response.status === 401 && retryAuth) {
      this.accessToken = '';
      this.accessTokenExpiresAt = 0;
      await this.authenticate({ force: true });
      return this.apiGet(relativePath, { retryAuth: false });
    }

    if (response.status < 200 || response.status >= 300) {
      const detail = errorDetail(response.data);
      throw responseError(
        `Milestone respondió HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
        'MILESTONE_API_ERROR',
        response.status,
      );
    }
    return response.data || {};
  }

  async listCollection(resource, { includeDisabled = true, maxItems = this.maxDevices } = {}) {
    const collected = [];
    const maxPages = Math.ceil(maxItems / this.pageSize) + 1;

    for (let page = 0; page < maxPages && collected.length < maxItems; page += 1) {
      const disabled = includeDisabled ? '&disabled' : '';
      const payload = await this.apiGet(
        `/api/rest/v1/${resource}?page=${page}&size=${this.pageSize}${disabled}`,
      );
      const rows = Array.isArray(payload?.array) ? payload.array : [];
      collected.push(...rows.slice(0, Math.max(0, maxItems - collected.length)));
      if (rows.length < this.pageSize) break;
    }
    return collected;
  }

  async testConnection() {
    const gatewayResponse = await this.rawRequest('/api/.well-known/uris', {
      headers: { 'Accept': 'application/json' },
    });
    if (gatewayResponse.status < 200 || gatewayResponse.status >= 300) {
      throw responseError(
        `El API Gateway de Milestone no respondió correctamente (HTTP ${gatewayResponse.status}).`,
        'MILESTONE_GATEWAY_UNAVAILABLE',
        gatewayResponse.status,
      );
    }

    await this.authenticate({ force: true });
    const sites = await this.apiGet('/api/rest/v1/sites?page=0&size=5');
    const firstSite = Array.isArray(sites?.array) ? sites.array[0] : null;
    return {
      ok: true,
      adapter: this.name,
      apiGateway: this.baseUrl,
      siteId: text(firstSite?.id),
      siteName: text(firstSite?.displayName ?? firstSite?.name, 'XProtect VMS'),
      authenticated: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async listDevices() {
    await this.authenticate();
    const [cameras, hardware, recordingServers] = await Promise.all([
      this.listCollection('cameras', { includeDisabled: true, maxItems: this.maxDevices }),
      this.listCollection('hardware', { includeDisabled: true, maxItems: this.maxDevices }),
      this.listCollection('recordingServers', { includeDisabled: true, maxItems: 500 }),
    ]);

    const hardwareById = new Map(
      hardware.map((item) => [text(item?.id).toLowerCase(), item]).filter(([id]) => id),
    );
    const recordingServerById = new Map(
      recordingServers.map((item) => [text(item?.id).toLowerCase(), item]).filter(([id]) => id),
    );

    return cameras.map((camera) => {
      const cameraId = text(camera?.id);
      const hardwareId = relationId(camera, 'parent');
      const hardwareItem = hardwareById.get(hardwareId.toLowerCase()) || {};
      const recordingServerId = relationId(hardwareItem, 'parent');
      const recordingServer = recordingServerById.get(recordingServerId.toLowerCase()) || {};
      const cameraEnabled = asEnabled(camera?.enabled, true);
      const hardwareEnabled = asEnabled(hardwareItem?.enabled, true);
      const enabled = cameraEnabled && hardwareEnabled;
      const hardwareAddress = safeOrigin(hardwareItem?.address);
      const ipAddress = hostFromAddress(hardwareItem?.address);

      return {
        externalId: cameraId,
        sourceSystem: 'MILESTONE',
        type: 'CAMERA',
        name: text(camera?.displayName ?? camera?.name, `Cámara ${cameraId}`),
        ipAddress,
        macAddress: text(camera?.macAddress ?? hardwareItem?.macAddress).toUpperCase(),
        manufacturer: text(hardwareItem?.manufacturer ?? hardwareItem?.vendor ?? hardwareItem?.brand),
        model: text(hardwareItem?.model),
        status: enabled ? 'CONFIGURED' : 'DISABLED',
        connectionVerified: false,
        capabilities: {
          inventory: true,
          status: false,
          snapshot: false,
          configurationApi: true,
        },
        metadata: {
          simulated: false,
          cameraId,
          cameraEnabled,
          channel: camera?.channel ?? null,
          description: text(camera?.description),
          configurationLastModified: text(camera?.lastModified),
          hardwareId,
          hardwareName: text(hardwareItem?.displayName ?? hardwareItem?.name),
          hardwareEnabled,
          hardwareAddress,
          recordingServerId,
          recordingServerName: text(recordingServer?.displayName ?? recordingServer?.name),
        },
      };
    }).filter((item) => item.externalId);
  }

  async execute(command) {
    const type = text(command?.Tipo ?? command?.type).toUpperCase();
    if (type === 'PING') {
      return this.testConnection();
    }
    if (type === 'INVENTORY_SYNC') {
      const devices = await this.listDevices();
      return {
        inventoryRequested: true,
        sourceSystem: 'MILESTONE',
        deviceCount: devices.length,
        devices,
      };
    }
    throw responseError(
      `El adaptador Milestone no admite el comando ${type || 'desconocido'}.`,
      'UNSUPPORTED_COMMAND',
    );
  }
}
