import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const bootId = randomUUID();

function safeCode(value) {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(String(value || '')) ? String(value) : undefined;
}

function sanitizeText(value, maxLength = 320) {
  let text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return undefined;
  text = text
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:Bearer\s+)?[A-Za-z0-9+/_=-]{40,}/g, '[redacted]')
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, '[data-url]');
  return text.slice(0, maxLength);
}

function safeStack(error) {
  const raw = String(error?.stack || '');
  if (!raw) return undefined;
  const cwd = process.cwd().replace(/\\/g, '/');
  return raw
    .split('\n')
    .slice(0, 8)
    .map((line, index) => {
      const normalized = line.replace(/\\/g, '/').replaceAll(cwd, '<app>');
      return index === 0 ? sanitizeText(normalized, 320) : normalized.slice(0, 320);
    })
    .filter(Boolean)
    .join('\n');
}

export function safeError(error, context = {}) {
  // Never serialize an SDK error object: it may contain credentials, request
  // bodies or response bodies. Only copy an allow-list of sanitized fields.
  return {
    requestId: safeCode(context.requestId),
    action: safeCode(context.action),
    phase: safeCode(context.phase),
    name: safeCode(error?.name) || 'Error',
    code: safeCode(error?.code),
    status: Number(error?.status || error?.statusCode || error?.response?.status) || undefined,
    message: sanitizeText(error?.message),
    stack: safeStack(error),
  };
}

export function logRuntime(event, snapshots = {}, extra = {}) {
  console.log(JSON.stringify({ event, bootId, pid: process.pid, timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage(), ...snapshots, ...extra }));
}
export function startDiagnostics(snapshot) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousRss = process.memoryUsage().rss;
  logRuntime('runtime_boot', snapshot(), { node: process.version,
    release: String(process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '').slice(0,80) });
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    logRuntime(rss - previousRss >= 32 * 1024 * 1024 ? 'runtime_memory_peak' : 'runtime_sample', snapshot(), {
      eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6), eventLoopMaxMs: Math.round(delay.max / 1e6),
    });
    previousRss = rss;
    delay.reset();
  }, 30_000);
  timer.unref();
  return () => { clearInterval(timer); delay.disable(); };
}
