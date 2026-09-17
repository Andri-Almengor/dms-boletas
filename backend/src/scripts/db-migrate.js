import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptPool } from './db-script.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');
const checksum = (value) => createHash('sha256').update(value).digest('hex');
const pool = scriptPool();
try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const digest = checksum(sql);
    const existing = await pool.query('SELECT checksum FROM schema_migrations WHERE version=$1', [file]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== digest) throw new Error(`La migración aplicada ${file} cambió de contenido.`);
      console.log(`skip ${file}`); continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES($1,$2)', [file, digest]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
} finally { await pool.end(); }
