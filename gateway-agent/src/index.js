import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process, { loadEnvFile } from 'node:process';
import { createAdapterFromEnvironment } from './adapters/adapter-factory.js';
import { GatewayClient } from './gateway-client.js';

const VERSION = '0.9.0';
const envPath = path.resolve(process.cwd(), '.env');
const checkConfigOnly = process.argv.includes('--check-config');
const checkSourceOnly = process.argv.includes('--check-source');

if (existsSync(envPath)) {
  try {
    loadEnvFile(envPath);
  } catch (error) {
    console.error(`No fue posible leer ${envPath}: ${error?.message || 'archivo inválido'}`);
    process.exit(1);
  }
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(
      `Falta ${name}. Copie .env.example como .env y complete la configuración requerida.`,
    );
  }
  return value;
}

function safeError(error) {
  return `${error?.code || 'ERROR'}: ${error?.message || 'Error desconocido'}`;
}

let adapter;
try {
  adapter = createAdapterFromEnvironment(process.env);
} catch (error) {
  console.error(`Configuración del adaptador incompleta: ${error?.message || 'revise el archivo .env'}`);
  console.error(`Archivo esperado: ${envPath}`);
  process.exit(1);
}

const heartbeatMs = Math.max(10_000, Number(process.env.DMS_GATEWAY_HEARTBEAT_MS || 30_000));
const pollMs = Math.max(5_000, Number(process.env.DMS_GATEWAY_POLL_MS || 10_000));
const defaultInventoryMs = adapter.name === 'NETWORK_DISCOVERY' ? 10 * 60_000 : 0;
const configuredInventoryMs = Number(process.env.DMS_GATEWAY_INVENTORY_SYNC_MS || defaultInventoryMs);
const inventoryMs = configuredInventoryMs > 0
  ? Math.max(60_000, Math.min(24 * 60 * 60_000, configuredInventoryMs))
  : 0;

let client = null;
let stopping = false;
let polling = false;
let inventoryPromise = null;
let heartbeatTimer = null;
let pollTimer = null;
let inventoryTimer = null;

function log(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

async function validateSource() {
  if (typeof adapter.testConnection !== 'function') {
    throw new Error(`El adaptador ${adapter.name} no implementa una prueba de fuente.`);
  }
  const result = await adapter.testConnection();
  const site = result?.siteName ? ` · ${result.siteName}` : '';
  const message = result?.message ? ` ${result.message}` : '';
  console.log(`Fuente ${adapter.name} accesible${site}.${message}`);
  return result;
}

function createGatewayClient() {
  return new GatewayClient({
    baseUrl: requiredEnvironment('DMS_GATEWAY_URL'),
    gatewayId: requiredEnvironment('DMS_GATEWAY_ID'),
    token: requiredEnvironment('DMS_GATEWAY_TOKEN'),
    timeoutMs: Number(process.env.DMS_GATEWAY_TIMEOUT_MS || 12_000),
  });
}

async function heartbeat() {
  try {
    await client.heartbeat({
      hostname: os.hostname(),
      agentVersion: `${VERSION} · ${adapter.name}`,
      capabilities: adapter.capabilities(),
    });
    log('Heartbeat enviado.', 'Estado ONLINE.');
  } catch (error) {
    log('Heartbeat falló.', safeError(error));
  }
}

async function syncInventory(reason = 'manual') {
  if (inventoryPromise) return inventoryPromise;
  inventoryPromise = (async () => {
    try {
      log('Sincronizando inventario.', `Motivo: ${reason}.`);
      const devices = await adapter.listDevices();
      const result = await client.syncInventory(devices);
      log('Inventario sincronizado.', `${result?.received ?? devices.length} dispositivo(s) reportado(s).`);
      return result;
    } finally {
      inventoryPromise = null;
    }
  })();
  return inventoryPromise;
}

async function uploadSnapshot(command, result) {
  const snapshot = result?.snapshot;
  if (!snapshot?.dataBase64) return result;
  const stored = await client.uploadSnapshot({
    commandId: command.ComandoID,
    deviceId: command.payload?.deviceId || command.payload?.DispositivoIntegracionID || '',
    mimeType: snapshot.mimeType,
    dataBase64: snapshot.dataBase64,
    capturedAt: snapshot.capturedAt,
  });
  return {
    ...result,
    snapshot: {
      snapshotId: stored.snapshotId,
      expiresAt: stored.expiresAt,
      mimeType: stored.mimeType,
      bytes: stored.bytes,
      transport: snapshot.transport || '',
    },
  };
}

async function executeCommand(command) {
  try {
    const type = String(command.Tipo || '').toUpperCase();
    let result;
    if (type === 'INVENTORY_SYNC') result = await syncInventory('command');
    else result = await adapter.execute(command);
    result = await uploadSnapshot(command, result);
    await client.completeCommand(command.ComandoID, result || {});
    log('Comando completado.', `${type} · ${command.ComandoID}`);
  } catch (error) {
    await client.failCommand(command.ComandoID, {
      code: error?.code || 'COMMAND_FAILED',
      message: error?.message || 'Error desconocido al ejecutar el comando.',
    });
    log('Comando falló.', `${command.Tipo} · ${safeError(error)}`);
  }
}

async function poll() {
  if (polling || stopping) return;
  polling = true;
  try {
    const commands = await client.pollCommands();
    for (const command of commands || []) {
      await executeCommand(command);
    }
  } catch (error) {
    log('Polling falló.', safeError(error));
  } finally {
    polling = false;
  }
}

async function start() {
  client = createGatewayClient();
  log('Iniciando DMS Integration Gateway Agent.', `v${VERSION} · ${adapter.name}`);
  await heartbeat();
  if (inventoryMs > 0) {
    try {
      await syncInventory('startup');
    } catch (error) {
      log('Sincronización inicial falló.', safeError(error));
    }
  }
  await poll();
  heartbeatTimer = setInterval(heartbeat, heartbeatMs);
  pollTimer = setInterval(poll, pollMs);
  if (inventoryMs > 0) inventoryTimer = setInterval(() => syncInventory('periodic').catch((error) => log('Sincronización periódica falló.', safeError(error))), inventoryMs);
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log('Deteniendo agente.', signal || 'shutdown');
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (inventoryTimer) clearInterval(inventoryTimer);
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

if (checkConfigOnly) {
  try {
    createGatewayClient();
    console.log(`Configuración válida. Adaptador: ${adapter.name}.`);
    process.exit(0);
  } catch (error) {
    console.error(safeError(error));
    process.exit(1);
  }
} else if (checkSourceOnly) {
  validateSource()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(safeError(error));
      process.exit(1);
    });
} else {
  start().catch((error) => {
    console.error(`No fue posible iniciar el agente: ${safeError(error)}`);
    process.exit(1);
  });
}
