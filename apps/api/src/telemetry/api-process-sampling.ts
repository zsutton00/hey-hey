import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from 'node:perf_hooks';

// Aggregate process evidence only. No request content or heap inspection.
export function startApiProcessSampling(
  emit: (record: Record<string, unknown>) => void,
): () => void {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let gcCount = 0;
  let gcDurationMs = 0;
  let gcMaxMs = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcCount++;
      gcDurationMs += entry.duration;
      gcMaxMs = Math.max(gcMaxMs, entry.duration);
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  let cpu = process.cpuUsage();
  let elapsed = performance.now();
  let utc = new Date().toISOString();
  let loop = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const now = performance.now();
    const nextCpu = process.cpuUsage();
    const nextLoop = performance.eventLoopUtilization();
    const endUtc = new Date().toISOString();
    const elapsedMs = now - elapsed;
    const record = {
      message: 'API diagnostic process interval',
      intervalStartUtc: utc,
      intervalEndUtc: endUtc,
      elapsedMs,
      cpuUserMs: (nextCpu.user - cpu.user) / 1000,
      cpuSystemMs: (nextCpu.system - cpu.system) / 1000,
      profilingEnabled:
        process.env.API_DIAGNOSTIC_CPU_PROFILE_ENABLED === 'true',
      cpuCoreUtilization:
        (nextCpu.user - cpu.user + nextCpu.system - cpu.system) /
        1000 /
        elapsedMs,
      eventLoopUtilization: performance.eventLoopUtilization(nextLoop, loop)
        .utilization,
      eventLoopDelaySampleCount: delay.count,
      ...(delay.count
        ? {
            eventLoopDelayP50Ms: delay.percentile(50) / 1e6,
            eventLoopDelayP99Ms: delay.percentile(99) / 1e6,
            eventLoopDelayMaxMs: delay.max / 1e6,
          }
        : {}),
      gcCount,
      gcDurationMs,
      gcMaxMs,
    };
    try {
      emit(record);
    } catch {
      /* Diagnostics must not fail requests. */
    }
    cpu = nextCpu;
    loop = nextLoop;
    elapsed = now;
    utc = endUtc;
    gcCount = 0;
    gcDurationMs = 0;
    gcMaxMs = 0;
    delay.reset();
  }, 5000);
  timer.unref();
  return () => {
    clearInterval(timer);
    observer.disconnect();
    delay.disable();
  };
}
