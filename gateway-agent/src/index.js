import os from 'node:os';
import process from 'node:process';
import { SimulatedAdapter } from './adapters/simulated.adapter.js';
import { GatewayClient } from './gateway-client.js';

const VERSION = '0.1.0';
const adapterName = String(process.env.DMS_GATEWAY_ADAPTER || 'simulated').trim().toLowerCase();
if (adapterName !== 'simulated') {
  throw new Error('En esta primera fase solo está disponible DMS_GATEWAY_ADAPTER=simulated.');
}

const heartbeatMs = Math.max(10_000, Number(process.env.DMS_GATEWAY_HEARTBEAT_MS || 30_000));
const pollMs = Math.max(5_000, Number(process.env.DMS_GATEWAY_POLL_MS || 10_000));
const adapter = new SimulatedAdapter({
  deviceCount: process.env.DMS_SIMULATED_DEVICE_COUNT,
});
const client = new GatewayClient({
  baseUrl: process.env.DMS_GATEWAY_URL,
  gatewayId: process.env.DMS_GATEWAY_ID,
  token: process.env.DMS_GATEWAY_TOKEN,
});

let stopping = false;
let polling = false;
let heartbeatTimer = null;
let pollTimer = null;

function log(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function safeError(error) {
  return `${error?.code || 'ERROR'}: ${error?.message || 'Error desconocido'}`;
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

  heartbeatTimer = setInterval(() => {
    heartbeat().catch((error) => log('Heartbeat fallido.', safeError(error)));
  }, heartbeatMs);
  pollTimer = setInterval(() => void pollCommands(), pollMs);
  heartbeatTimer.unref?.();
  pollTimer.unref?.();
  await pollCommands();
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  log(`Cerrando agente por ${signal}.`);
  await heartbeat(`Agente detenido por ${signal}`).catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  log('Promesa no controlada.', safeError(error));
});

start().catch((error) => {
  console.error(`No fue posible iniciar el agente: ${safeError(error)}`);
  process.exit(1);
});
