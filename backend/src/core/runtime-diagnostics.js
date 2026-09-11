import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const bootId = randomUUID();
export function safeError(error) {
  // Never serialize an SDK error: it may contain credentials/body/config.
  const safe = (value) => /^[A-Za-z0-9_.:-]{1,80}$/.test(String(value || '')) ? String(value) : 'redacted';
  return { name: safe(error?.name), code: safe(error?.code), status: Number(error?.status || error?.response?.status) || undefined };
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
