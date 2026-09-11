import assert from 'node:assert/strict';
import fs from 'node:fs';

const availability = fs.readFileSync('src/services/backendAvailability.js', 'utf8');
const gate = fs.readFileSync('src/components/system/BackendAvailabilityGate.jsx', 'utf8');
const main = fs.readFileSync('src/main.jsx', 'utf8');
const api = fs.readFileSync('src/api.js', 'utf8');
const serviceWorker = fs.readFileSync('public/sw.js', 'utf8');

assert.match(availability, /fetch\('\/api\/health'/, 'La disponibilidad debe comprobar el health real del backend.');
assert.match(availability, /state\.status === 'ready'/, 'El monitor debe dejar de sondear cuando el backend esté listo.');
assert.match(availability, /waitForBackendReady/, 'Las solicitudes deben poder esperar la recuperación real del backend.');
assert.match(gate, /Conectando con el servidor/, 'La interfaz debe explicar que el backend todavía está iniciando.');
assert.match(gate, /backend-availability-overlay/, 'Una caída posterior debe bloquear gestiones online sin desmontar la app ya abierta.');
assert.ok(main.indexOf('<BackendAvailabilityGate>') < main.indexOf('<AuthProvider>'), 'El health debe validarse antes de montar autenticación y rutas en un arranque desde caché.');
assert.match(api, /markBackendUnavailable\(error\)/, 'Los errores transitorios de API deben activar el estado global de reconexión.');
assert.match(api, /await waitForBackendReady\(signal\)/, 'Los reintentos no deben agotarse mientras el backend todavía no pasa health.');
assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)\) return/, 'El Service Worker nunca debe responder health/API desde caché.');

console.log('backend-readiness-gate characterization passed');
