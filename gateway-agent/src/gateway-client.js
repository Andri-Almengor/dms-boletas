function normalizedBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error('DMS_GATEWAY_URL debe utilizar HTTPS fuera del entorno local.');
  }
  return url.toString().replace(/\/$/, '');
}

function retryAfterMs(response) {
  const seconds = Number(response.headers.get('retry-after') || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class GatewayClient {
  constructor({ baseUrl, gatewayId, token, timeoutMs = 20_000 }) {
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.gatewayId = String(gatewayId || '').trim();
    this.token = String(token || '').trim();
    this.timeoutMs = Math.max(5_000, Number(timeoutMs) || 20_000);
    if (!this.gatewayId || !this.token) throw new Error('Faltan DMS_GATEWAY_ID o DMS_GATEWAY_TOKEN.');
  }

  async request(path, body = {}, attempt = 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/integration-gateway${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json;charset=utf-8',
          'X-DMS-Gateway-ID': this.gatewayId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let result = null;
      try { result = text ? JSON.parse(text) : null; } catch { /* handled below */ }
      if (!response.ok || !result?.ok) {
        const error = new Error(result?.error?.message || `El servidor respondió ${response.status}.`);
        error.code = result?.error?.code || 'GATEWAY_REQUEST_FAILED';
        error.status = response.status;
        error.retryAfterMs = retryAfterMs(response);
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          await wait(error.retryAfterMs || (attempt + 1) * 1_500);
          return this.request(path, body, attempt + 1);
        }
        throw error;
      }
      return result.data;
    } finally {
      clearTimeout(timer);
    }
  }

  heartbeat(payload) {
    return this.request('/heartbeat', payload);
  }

  syncInventory(items) {
    return this.request('/inventory', { items });
  }

  pollCommands() {
    return this.request('/commands/poll', {});
  }

  completeCommand(commandId, result = {}) {
    return this.request('/commands/result', {
      commandId,
      success: true,
      result,
    });
  }

  failCommand(commandId, error) {
    return this.request('/commands/result', {
      commandId,
      success: false,
      errorCode: error?.code || 'AGENT_COMMAND_ERROR',
      errorMessage: error?.message || 'El comando no pudo completarse.',
    });
  }
}
