import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process, { loadEnvFile } from 'node:process';
import { createAdapterFromEnvironment } from './adapters/adapter-factory.js';
import { GatewayClient } from './gateway-client.js';

const VERSION = '0.4.0';
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
  });
}

async function heartbeat(lastError = '') {
  const result = await client.heartbeat({
    version: VERSION,
    name: process.env.DMS_GATEWAY_NAME || os.hostname(),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    adapter: adapter.name,
    capabilities: adapter.capabilities(),
    lastError,
  });
  log('Heartbeat confirmado.', result.online ? 'ONLINE' : 'RECIBIDO');
  return result;
}

async function syncInventory() {
  if (inventoryPromise) return inventoryPromise;
  inventoryPromise = (async () => {
    const startedAt = Date.now();
    const devices = await adapter.listDevices();
    const result = await client.syncInventory(devices);
    log(
      'Inventario sincronizado.',
      `${result.accepted} dispositivo(s), ${result.added} nuevo(s), ${Date.now() - startedAt} ms.`,
    );
    return result;
  })();
  try {
    return await inventoryPromise;
  } finally {
    inventoryPromise = null;
  }
}

async function processCommand(command) {
  const commandId = String(command?.ComandoID || command?.commandId || '');
  if (!commandId) return;
  try {
    const type = String(command.Tipo || command.type || '').toUpperCase();
    let result;
    if (type === 'INVENTORY_SYNC') {
      const inventory = await syncInventory();
      result = { inventoryRequested: true, inventory };
    } else {
      result = await adapter.execute(command);
    }
    await client.completeCommand(commandId, result);
    log('Comando completado.', `${command.Tipo} · ${commandId}`);
  } catch (error) {
    await client.failCommand(commandId, error).catch(() => {});
    log('Comando fallido.', `${commandId} · ${safeError(error)}`);
  }
}

async function pollCommands() {
  if (polling || stopping) return;
  polling = true;
  try {
    const commands = await client.pollCommands();
    for (const command of commands || []) {
      if (stopping) break;
      await processCommand(command);
    }
  } catch (error) {
    log('No fue posible consultar comandos.', safeError(error));
  } finally {
    polling = false;
  }
}

async function start() {
  log('Iniciando DMS Integration Gateway Agent.', `v${VERSION} · ${adapter.name}`);
  try {
    await heartbeat();
    await syncInventory();
  } catch (error) {
    log('La conexión inicial no pudo completarse.', safeError(error));
    await heartbeat(safeError(error)).catch(() => {});
  }

  // Estos timers deben permanecer referenciados para mantener vivo el servicio.
  heartbeatTimer = setInterval(() => {
    heartbeat().catch((error) => log('Heartbeat fallido.', safeError(error)));
  }, heartbeatMs);
  pollTimer = setInterval(() => void pollCommands(), pollMs);
  if (inventoryMs > 0) {
    inventoryTimer = setInterval(() => {
      syncInventory().catch((error) => log('Sincronización periódica fallida.', safeError(error)));
    }, inventoryMs);
    log('Sincronización periódica habilitada.', `Cada ${Math.round(inventoryMs / 60_000)} minuto(s).`);
  }

  await pollCommands();
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(inventoryTimer);
  log(`Cerrando agente por ${signal}.`);
  if (client) await heartbeat(`Agente detenido por ${signal}`).catch(() => {});
  process.exit(0);
}

async function bootstrap() {
  if (checkSourceOnly) {
    await validateSource();
    return;
  }

  client = createGatewayClient();
  if (checkConfigOnly) {
    const gatewayPreview = client.gatewayId.length > 18
      ? `${client.gatewayId.slice(0, 18)}…`
      : client.gatewayId;
    console.log(
      `Configuración válida para ${gatewayPreview} en ${client.baseUrl}. Adaptador: ${adapter.name}.`,
    );
    return;
  }

  await start();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  log('Promesa no controlada.', safeError(error));
});

bootstrap().catch((error) => {
  console.error(`No fue posible iniciar el agente: ${safeError(error)}`);
  process.exit(1);
});
