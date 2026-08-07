import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError, badRequest, notFound } from '../core/errors.js';
import { readTables } from '../infra/sheets.repository.js';

const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 5 * 60_000;
const MAX_SNAPSHOTS = 120;
const snapshots = new Map();

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function prune(now = Date.now()) {
  for (const [id, item] of snapshots.entries()) {
    if (item.expiresAt <= now) snapshots.delete(id);
  }
  if (snapshots.size <= MAX_SNAPSHOTS) return;
  [...snapshots.entries()]
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
    .slice(0, snapshots.size - MAX_SNAPSHOTS)
    .forEach(([id]) => snapshots.delete(id));
}

function decodeBase64(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw badRequest('La captura no contiene Base64 válido.');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw badRequest('La captura está vacía.');
  if (buffer.length > MAX_SNAPSHOT_BYTES) {
    throw new AppError('CAMERA_SNAPSHOT_TOO_LARGE', 'La captura supera el máximo permitido de 3 MB.', 413);
  }
  return buffer;
}

function mimeType(value) {
  const normalized = text(value, 80).toLowerCase();
  if (!['image/jpeg', 'image/png'].includes(normalized)) {
    throw badRequest('La captura debe ser JPEG o PNG.');
  }
  return normalized;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function registerIntegrationGatewaySnapshot(gateway, payload = {}) {
  prune();
  const commandId = text(payload.commandId, 180);
  const deviceId = text(payload.deviceId, 180);
  if (!commandId || !deviceId) throw badRequest('La captura debe indicar comando y cámara.');

  const tables = await readTables(['IntegracionComandos', 'IntegracionDispositivos']);
  const command = (tables.IntegracionComandos || []).find((row) => (
    text(row.ComandoID, 180) === commandId
    && text(row.GatewayID, 180) === text(gateway.GatewayID, 180)
    && String(row.Tipo || '').toUpperCase() === 'CAMERA_SNAPSHOT'
  ));
  if (!command) throw notFound('No se encontró el comando de captura para este gateway.');
  const device = (tables.IntegracionDispositivos || []).find((row) => (
    text(row.DispositivoIntegracionID, 180) === deviceId
    && text(row.GatewayID, 180) === text(gateway.GatewayID, 180)
  ));
  if (!device) throw notFound('No se encontró la cámara asociada a la captura.');

  const buffer = decodeBase64(payload.dataBase64);
  const type = mimeType(payload.mimeType || 'image/jpeg');
  const snapshotId = `snap-${randomUUID()}`;
  const accessKey = randomBytes(32).toString('base64url');
  const now = Date.now();
  snapshots.set(snapshotId, {
    snapshotId,
    gatewayId: text(gateway.GatewayID, 180),
    commandId,
    deviceId,
    buffer,
    mimeType: type,
    accessKey,
    createdAt: now,
    expiresAt: now + SNAPSHOT_TTL_MS,
  });
  return {
    snapshotId,
    commandId,
    deviceId,
    mimeType: type,
    bytes: buffer.length,
    expiresAt: new Date(now + SNAPSHOT_TTL_MS).toISOString(),
  };
}

export function integrationGatewaySnapshotPresentation(snapshotId) {
  prune();
  const snapshot = snapshots.get(text(snapshotId, 180));
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshotId,
    deviceId: snapshot.deviceId,
    mimeType: snapshot.mimeType,
    bytes: snapshot.buffer.length,
    expiresAt: new Date(snapshot.expiresAt).toISOString(),
    url: `/api/integration-gateway/snapshots/${encodeURIComponent(snapshot.snapshotId)}?access=${encodeURIComponent(snapshot.accessKey)}`,
  };
}

export function readIntegrationGatewaySnapshot(snapshotId, accessKey) {
  prune();
  const snapshot = snapshots.get(text(snapshotId, 180));
  if (!snapshot || !safeEqual(snapshot.accessKey, accessKey)) return null;
  return snapshot;
}

export const INTEGRATION_GATEWAY_SNAPSHOT_POLICY = Object.freeze({
  maxBytes: MAX_SNAPSHOT_BYTES,
  ttlMs: SNAPSHOT_TTL_MS,
  maxSnapshots: MAX_SNAPSHOTS,
});
