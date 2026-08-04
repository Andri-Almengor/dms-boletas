import crypto from 'node:crypto';
import { AppError, badRequest } from '../core/errors.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const MAX_SECRET_LENGTH = 4096;

function encryptionKey() {
  const raw = String(process.env.PASSWORD_VAULT_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new AppError(
      'PASSWORD_VAULT_NOT_CONFIGURED',
      'El gestor de contraseñas todavía no tiene configurada su llave de cifrado.',
      503,
    );
  }

  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    key = Buffer.from(normalized, 'base64');
  }

  if (key.length !== 32) {
    throw new AppError(
      'PASSWORD_VAULT_INVALID_KEY',
      'PASSWORD_VAULT_ENCRYPTION_KEY debe representar exactamente 32 bytes.',
      503,
    );
  }
  return key;
}

function identityValue(identity = {}) {
  return [
    VERSION,
    String(identity.credentialId || identity.CredencialID || '').trim(),
    String(identity.clientId || identity.ClienteID || '').trim(),
    String(identity.categoryId || identity.CategoriaCredencialID || '').trim(),
  ].join('|');
}

function aad(identity = {}) {
  const value = identityValue(identity);
  if (value.split('|').slice(1).some((item) => !item)) {
    throw badRequest('La identidad de la credencial está incompleta.');
  }
  return Buffer.from(value, 'utf8');
}

export function vaultEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptVaultSecret(secret, identity) {
  const value = String(secret ?? '');
  if (!value) throw badRequest('La contraseña es obligatoria.');
  if (value.length > MAX_SECRET_LENGTH) {
    throw badRequest(`La contraseña supera el máximo de ${MAX_SECRET_LENGTH.toLocaleString('es-CR')} caracteres.`);
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(aad(identity));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    PasswordCiphertext: encrypted.toString('base64'),
    PasswordIV: iv.toString('base64'),
    PasswordTag: tag.toString('base64'),
    PasswordVersion: VERSION,
  };
}

export function decryptVaultSecret(record = {}) {
  try {
    if (String(record.PasswordVersion || VERSION) !== VERSION) {
      throw new Error('Versión de cifrado no compatible.');
    }
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(String(record.PasswordIV || ''), 'base64'),
    );
    decipher.setAAD(aad(record));
    decipher.setAuthTag(Buffer.from(String(record.PasswordTag || ''), 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(String(record.PasswordCiphertext || ''), 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'PASSWORD_VAULT_DECRYPTION_FAILED',
      'No fue posible descifrar esta credencial. Revise que la llave del servidor no haya cambiado.',
      500,
    );
  }
}

export const PASSWORD_VAULT_CRYPTO = Object.freeze({
  algorithm: ALGORITHM,
  version: VERSION,
  ivBytes: IV_BYTES,
});
