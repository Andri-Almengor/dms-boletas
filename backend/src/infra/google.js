import { google } from 'googleapis';
import { env } from '../config/env.js';
import { createObservedDriveApi } from './drive-observer.js';

if (!env.googleClientEmail || !env.googlePrivateKey) {
  throw new Error('Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY para las integraciones de Google Drive/Docs/Sheets.');
}

const auth = new google.auth.JWT({
  email: env.googleClientEmail,
  key: env.googlePrivateKey,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/presentations',
  ],
});

export const googleAuth = auth;

// Google Sheets remains available only for user-facing generated spreadsheets
// (for example maintenance reports). Operational persistence never uses this API.
export const sheetsApi = google.sheets({ version: 'v4', auth });
const rawDriveApi = google.drive({ version: 'v3', auth });
export const driveApi = createObservedDriveApi(rawDriveApi);
export const docsApi = google.docs({ version: 'v1', auth });
export const slidesApi = google.slides({ version: 'v1', auth });

// Compatibility diagnostic while old callers are retired. It deliberately has
// no cache/queue/revision state because Sheets is no longer the database.
export function googleSheetsGateSnapshot() {
  return { persistenceEnabled: false, reportOnly: true, purpose: 'generated-reports-only' };
}

export const sheetsRevisionTracker = Object.freeze({
  snapshot: () => ({}),
  isCurrent: () => true,
  advance() {},
  snapshotState: () => ({ persistenceEnabled: false }),
});
