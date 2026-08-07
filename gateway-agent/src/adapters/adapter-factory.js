import { MilestoneAdapter } from './milestone.adapter.js';
import { SimulatedAdapter } from './simulated.adapter.js';

function envText(env, name, fallback = '') {
  return String(env?.[name] ?? fallback).trim();
}

function envBoolean(env, name, fallback = false) {
  const value = envText(env, name);
  if (!value) return fallback;
  return /^(1|true|yes|y|si|sí|on)$/i.test(value);
}

function required(env, name) {
  const value = envText(env, name);
  if (!value) throw new Error(`Falta ${name} para el adaptador seleccionado.`);
  return value;
}

export function createAdapterFromEnvironment(env = process.env) {
  const adapterName = envText(env, 'DMS_GATEWAY_ADAPTER', 'simulated').toLowerCase();

  if (adapterName === 'simulated') {
    return new SimulatedAdapter({
      deviceCount: envText(env, 'DMS_SIMULATED_DEVICE_COUNT', '3'),
    });
  }

  if (adapterName === 'milestone') {
    return new MilestoneAdapter({
      baseUrl: required(env, 'DMS_MILESTONE_URL'),
      username: required(env, 'DMS_MILESTONE_USERNAME'),
      password: required(env, 'DMS_MILESTONE_PASSWORD'),
      allowHttp: envBoolean(env, 'DMS_MILESTONE_ALLOW_HTTP', false),
      allowInsecureTls: envBoolean(env, 'DMS_MILESTONE_ALLOW_INSECURE_TLS', false),
      caFile: envText(env, 'DMS_MILESTONE_CA_FILE'),
      timeoutMs: envText(env, 'DMS_MILESTONE_TIMEOUT_MS', '15000'),
      pageSize: envText(env, 'DMS_MILESTONE_PAGE_SIZE', '100'),
      maxDevices: envText(env, 'DMS_MILESTONE_MAX_DEVICES', '2500'),
    });
  }

  throw new Error(
    `DMS_GATEWAY_ADAPTER=${adapterName || '(vacío)'} no es válido. Use simulated o milestone.`,
  );
}
