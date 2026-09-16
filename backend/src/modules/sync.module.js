import { buildSyncDelta } from '../services/sync-delta.service.js';

export const syncHandlers = Object.freeze({
  delta: async (ctx) => buildSyncDelta(ctx),
});
