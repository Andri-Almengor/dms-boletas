// PostgreSQL is the operational datastore. This compatibility module keeps the
// app bootstrap stable while intentionally disabling the old Sheets route cache.
export function runWithSheetsRouteReadCache(_route, operation) {
  return operation();
}
export function sheetsRouteReadCacheSnapshot() {
  return { enabled: false, reason: 'postgres-persistence' };
}
export const SHEETS_ROUTE_READ_CACHE_POLICY = Object.freeze({ enabled: false });
