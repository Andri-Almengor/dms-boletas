// Compatibility import path retained to keep the migration blast radius small.
// All runtime persistence functions are implemented by PostgreSQL; this file performs no Google Sheets I/O.
export * from './postgres.repository.js';
