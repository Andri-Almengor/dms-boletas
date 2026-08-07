import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process, { loadEnvFile } from 'node:process';
import { createAdapterFromEnvironment } from './adapters/adapter-factory.js';
import { GatewayClient } from './gateway-client.js';

const VERSION = '0.2.0';
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

let client = null;
let stopping = false;
let polling = false;
let heartbeatTimer = null;
let pollTimer = null;

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
  console.log(`Fuente ${adapter.name} accesible${site}.`);
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
  const devices = await adapter.listDevices();
  const result = await client.syncInventory(devices);
  log('Inventario sincronizado.', `${result.accepted} dispositivo(s), ${result.added} nuevo(s).`);
  return result;
}

async function processCommand(command) {
  const commandId = String(command?.ComandoID || command?.commandId || '');
  if (!commandId) return;
  try {
    const result = await adapter.execute(command);
    if (String(command.Tipo || '').toUpperCase() === 'INVENTORY_SYNC') {
      const inventoryResult = await client.syncInventory(result.devices || []);
      delete result.devices;
      result.inventory = inventoryResult;
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

  await pollCommands();
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
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
