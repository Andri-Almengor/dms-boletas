const CORE_DATABASE_NAME = 'dms-boletas-offline';
const CORE_DATABASE_VERSION = 3;
const INSTALL_KEY = Symbol.for('dms.indexedDbVersionGuard');

export function compatibleIndexedDbVersion(databaseName, requestedVersion) {
  const requested = Number(requestedVersion);
  if (String(databaseName || '') !== CORE_DATABASE_NAME) return requestedVersion;
  if (!Number.isInteger(requested) || requested <= 0) return requestedVersion;
  return Math.max(requested, CORE_DATABASE_VERSION);
}

export function isIndexedDbVersionError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return name === 'versionerror'
    || message.includes('requested version') && message.includes('less than the existing version');
}

export function installIndexedDbVersionGuard(scope = globalThis) {
  const factory = scope?.indexedDB;
  if (!factory) return false;

  const prototype = Object.getPrototypeOf(factory);
  if (!prototype || prototype[INSTALL_KEY]) return Boolean(prototype?.[INSTALL_KEY]);
  const nativeOpen = prototype.open;
  if (typeof nativeOpen !== 'function') return false;

  const guardedOpen = function guardedIndexedDbOpen(databaseName, requestedVersion) {
    if (arguments.length < 2) return nativeOpen.call(this, databaseName);
    const compatibleVersion = compatibleIndexedDbVersion(databaseName, requestedVersion);
    return nativeOpen.call(this, databaseName, compatibleVersion);
  };

  try {
    Object.defineProperty(prototype, 'open', {
      configurable: true,
      writable: true,
      value: guardedOpen,
    });
    Object.defineProperty(prototype, INSTALL_KEY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true,
    });
    return true;
  } catch {
    return false;
  }
}

installIndexedDbVersionGuard();

export const INDEXED_DB_COMPATIBILITY = Object.freeze({
  coreDatabaseName: CORE_DATABASE_NAME,
  coreDatabaseVersion: CORE_DATABASE_VERSION,
});
