import { performance } from 'node:perf_hooks';
import { recordDriveCall } from '../services/performance-observability.service.js';

// Only promise-based methods used by this application. A plain facade avoids
// Proxy invariants on googleapis' frozen/non-configurable resource properties.
export const OBSERVED_DRIVE_METHODS = Object.freeze({
  files: Object.freeze(['create', 'get', 'list', 'copy', 'update', 'export']),
  permissions: Object.freeze(['create', 'delete']),
});

export function createObservedDriveApi(rawDriveApi, { record = recordDriveCall, now = () => performance.now() } = {}) {
  const facade = {};
  for (const [resourceName, methods] of Object.entries(OBSERVED_DRIVE_METHODS)) {
    const resource = rawDriveApi[resourceName];
    facade[resourceName] = {};
    for (const methodName of methods) {
      const method = resource[methodName].bind(resource);
      facade[resourceName][methodName] = (...args) => {
        const startedAt = now();
        let result;
        try {
          result = method(...args);
        } catch (error) {
          record({ count: 1, durationMs: now() - startedAt });
          throw error;
        }
        return Promise.resolve(result).finally(() => {
          record({ count: 1, durationMs: now() - startedAt });
        });
      };
    }
  }
  return facade;
}
