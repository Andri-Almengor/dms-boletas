const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const DEFAULT_BASE_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_MAX_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const originalFetch = globalThis.fetch;
const routerState = globalThis.__DMS_GEMINI_MODEL_ROUTER_STATE__ || {
  activeIndex: 0,
  cooldowns: new Map(),
  quotaStrikes: new Map(),
  lastActiveModel: '',
};
globalThis.__DMS_GEMINI_MODEL_ROUTER_STATE__ = routerState;

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function resolveModels(requestedModel = '') {
  const primary = clean(process.env.GEMINI_MODEL || 'gemini-3.5-flash', 100);
  const configured = clean(process.env.GEMINI_FALLBACK_MODELS, 500)
    .split(',')
    .map((value) => clean(value, 100))
    .filter(Boolean);
  const models = [primary, ...(configured.length ? configured : DEFAULT_FALLBACK_MODELS)];
  if (requestedModel) models.unshift(clean(requestedModel, 100));
  return [...new Set(models.filter(Boolean))];
}

function baseCooldownMs() {
  return positiveInteger(
    process.env.GEMINI_MODEL_QUOTA_COOLDOWN_MS,
    DEFAULT_BASE_COOLDOWN_MS,
    60_000,
    24 * 60 * 60 * 1000,
  );
}

function maxCooldownMs() {
  return positiveInteger(
    process.env.GEMINI_MODEL_MAX_QUOTA_COOLDOWN_MS,
    DEFAULT_MAX_COOLDOWN_MS,
    baseCooldownMs(),
    24 * 60 * 60 * 1000,
  );
}

function cooldownRemaining(model) {
  const remaining = Number(routerState.cooldowns.get(model) || 0) - Date.now();
  if (remaining <= 0) {
    routerState.cooldowns.delete(model);
    return 0;
  }
  return remaining;
}

function retryAfterMs(response, message = '') {
  const headerSeconds = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds * 1000;
  const match = String(message || '').match(/retry in\s+([\d.]+)s/i);
  const seconds = Number(match?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function markQuotaExhausted(model, response, message = '') {
  const strikes = Number(routerState.quotaStrikes.get(model) || 0) + 1;
  routerState.quotaStrikes.set(model, strikes);
  const adaptive = Math.min(baseCooldownMs() * (2 ** Math.max(0, strikes - 1)), maxCooldownMs());
  const hinted = retryAfterMs(response, message);
  const duration = Math.min(Math.max(adaptive, hinted), maxCooldownMs());
  routerState.cooldowns.set(model, Date.now() + duration);
  return duration;
}

function markSuccess(model, models) {
  routerState.quotaStrikes.delete(model);
  routerState.cooldowns.delete(model);
  const index = models.indexOf(model);
  if (index >= 0) routerState.activeIndex = index;
  if (routerState.lastActiveModel !== model) {
    routerState.lastActiveModel = model;
    console.warn(`[gemini-router] Modelo activo: ${model}.`);
  }
}

function candidateOrder(models) {
  if (!models.length) return [];
  const start = ((routerState.activeIndex % models.length) + models.length) % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
}

function nextAvailableModel(models, currentModel) {
  if (!models.length) return '';
  const currentIndex = models.indexOf(currentModel);
  for (let offset = 1; offset <= models.length; offset += 1) {
    const candidate = models[(Math.max(currentIndex, -1) + offset) % models.length];
    if (candidate && cooldownRemaining(candidate) === 0) return candidate;
  }
  return '';
}

async function quotaMessage(response) {
  try {
    const data = await response.clone().json();
    return clean(data?.error?.message, 1200);
  } catch {
    return '';
  }
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return String(input?.url || '');
}

function parseBody(init = {}) {
  if (typeof init.body !== 'string') return null;
  try {
    const body = JSON.parse(init.body);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function allModelsCoolingResponse(models) {
  const remaining = models.map(cooldownRemaining).filter((value) => value > 0);
  const retryMs = remaining.length ? Math.min(...remaining) : baseCooldownMs();
  return new Response(JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: `Todos los modelos de Gemini están temporalmente en cooldown. Reintente en aproximadamente ${Math.max(1, Math.ceil(retryMs / 1000))} segundos.`,
    },
  }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(Math.max(1, Math.ceil(retryMs / 1000))),
    },
  });
}

async function routedGeminiFetch(input, init = {}) {
  if (requestUrl(input).split('?')[0] !== GEMINI_INTERACTIONS_URL) {
    return originalFetch(input, init);
  }

  const originalBody = parseBody(init);
  if (!originalBody?.model) return originalFetch(input, init);

  const models = resolveModels(originalBody.model);
  const ordered = candidateOrder(models);
  const available = ordered.filter((model) => cooldownRemaining(model) === 0);
  if (!available.length) return allModelsCoolingResponse(models);

  let lastResponse = null;
  for (const model of available) {
    const body = { ...originalBody, model };
    const response = await originalFetch(input, { ...init, body: JSON.stringify(body) });
    lastResponse = response;

    if (response.status !== 429) {
      if (response.ok) markSuccess(model, models);
      return response;
    }

    const message = await quotaMessage(response);
    const cooldownMs = markQuotaExhausted(model, response, message);
    const nextModel = nextAvailableModel(models, model);
    const index = models.indexOf(model);
    if (index >= 0) routerState.activeIndex = (index + 1) % models.length;
    console.warn(
      `[gemini-router] ${model} alcanzó su cuota. Cooldown ${Math.ceil(cooldownMs / 60_000)} min.${nextModel ? ` Cambiando a ${nextModel}.` : ' No queda otro modelo disponible.'}`,
    );
  }

  return lastResponse || allModelsCoolingResponse(models);
}

if (typeof originalFetch === 'function' && globalThis.fetch !== routedGeminiFetch) {
  globalThis.fetch = routedGeminiFetch;
}

export function geminiModelRouterSnapshot() {
  const models = resolveModels();
  return {
    models,
    activeIndex: routerState.activeIndex,
    activeModel: models[routerState.activeIndex] || models[0] || '',
    cooldowns: Object.fromEntries(models.map((model) => [model, cooldownRemaining(model)])),
    quotaStrikes: Object.fromEntries(models.map((model) => [model, Number(routerState.quotaStrikes.get(model) || 0)])),
  };
}
