import { google } from 'googleapis';
import { env } from '../config/env.js';

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

export const sheetsApi = google.sheets({ version: 'v4', auth });
export const driveApi = google.drive({ version: 'v3', auth });
export const docsApi = google.docs({ version: 'v1', auth });
export const slidesApi = google.slides({ version: 'v1', auth });
