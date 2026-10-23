// Counter intervals are a separate series from Docker point snapshots.
export function counterIntervals(samples, select) {
  const intervals = [];
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    const a = select(samples[i - 1]);
    const b = select(samples[i]);
    if (!a || !b) {
      gaps.push({ index: i, reason: 'missing counters' });
      continue;
    }
    const seconds = Number(BigInt(b.startedAtNs) - BigInt(a.startedAtNs)) / 1e9;
    if (
      a.identity !== b.identity ||
      seconds <= 0 ||
      Object.keys(a.cpu).some((key) => b.cpu[key] < a.cpu[key])
    ) {
      gaps.push({
        index: i,
        reason: 'counter reset, identity change or invalid interval',
      });
      continue;
    }
    const delta = Object.fromEntries(
      Object.keys(a.cpu).map((key) => [key, b.cpu[key] - a.cpu[key]]),
    );
    intervals.push({
      startAtNs: a.startedAtNs,
      endAtNs: b.startedAtNs,
      seconds,
      cpuPercent: (delta.usage_usec / 1e6 / seconds) * 100,
      delta,
      processes: b.processes.flatMap((p) => {
        const old = a.processes.find(
          (q) => p.pid === q.pid && p.startTicks === q.startTicks,
        );
        return old && p.cpuTicks >= old.cpuTicks
          ? [
              {
                pid: p.pid,
                command: p.command,
                cpuPercent:
                  ((p.cpuTicks - old.cpuTicks) / b.clockTicks / seconds) * 100,
              },
            ]
          : [];
      }),
    });
  }
  const sorted = intervals.map((x) => x.cpuPercent).sort((a, b) => a - b);
  const elapsed = intervals.reduce((sum, x) => sum + x.seconds, 0);
  return {
    intervals,
    gaps,
    samples: intervals.length,
    mean: elapsed
      ? intervals.reduce((sum, x) => sum + x.cpuPercent * x.seconds, 0) /
        elapsed
      : null,
    p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    peak: sorted.at(-1) ?? null,
    peakInterval: intervals.reduce(
      (peak, x) => (!peak || x.cpuPercent > peak.cpuPercent ? x : peak),
      null,
    ),
    coverage:
      'Interval-average CPU; surviving processes only. Exited process CPU remains in cgroup totals. Sparse intervals cannot localize sub-interval peaks.',
  };
}

export function summarizeCounters(samples) {
  const names = [
    ...new Set(
      samples.flatMap((s) => Object.keys(s.resources?.containers ?? {})),
    ),
  ];
  return {
    containers: Object.fromEntries(
      names.map((name) => [
        name,
        counterIntervals(samples, (s) => s.resources?.containers[name]),
      ]),
    ),
    slice: counterIntervals(samples, (s) => s.resources?.slice),
    queryCollector: counterIntervals(samples, (s) => {
      const q = s.queryCollection;
      return q?.collectorCpuSeconds === undefined
        ? undefined
        : {
            identity: `${q.collectorCgroup}:${q.collectorPid}`,
            startedAtNs: q.endedAtNs,
            cpu: { usage_usec: q.collectorCpuSeconds * 1e6 },
            processes: [],
            clockTicks: 1,
          };
    }),
    gaps: samples.flatMap(
      (s) => s.resources?.gaps ?? ['resource counters absent'],
    ),
  };
}
