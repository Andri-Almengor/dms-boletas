import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPortablePostgresBackupFile, cleanupPortableBackup } from '../services/postgres-backup.service.js';
import { closePostgres } from '../infra/postgres.js';

function requiredArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
  if (!value) throw new Error(`Falta ${name} <ruta>.`);
  return value;
}

const out = path.resolve(requiredArg('--out'));
await mkdir(path.dirname(out), { recursive: true });
let backup;
try {
  backup = await createPortablePostgresBackupFile({ directory: path.dirname(out) });
  await copyFile(backup.outputPath, out);
  console.log(JSON.stringify({ step: 'cutover-backup', ok: true, output: out }));
} finally {
  await cleanupPortableBackup(backup).catch(() => {});
  await closePostgres().catch(() => {});
}
