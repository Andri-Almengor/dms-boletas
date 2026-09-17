// No-op compatibility after migration. The previous memory guard managed full
// Google Sheets table caches; PostgreSQL queries are bounded and not table-cached.
export function installSheetsMemoryGuard() { return { enabled: false, reason: 'postgres-persistence' }; }
export function sheetsMemoryGuardSnapshot() { return { enabled: false }; }
