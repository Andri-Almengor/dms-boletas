import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, '0.0.0.0', () => {
  console.log(`DMS backend escuchando en el puerto ${env.port}`);
});

function shutdown(signal) {
  console.log(`${signal}: cerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
