import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function selectDiagnosticRequests(
  path,
  runId,
  start,
  end,
  limit = 20,
) {
  const selected = [];
  let eligible = 0;
  let unmapped = 0;
  for await (const line of createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })) {
    if (!line.trim()) continue;
    const point = JSON.parse(line);
    if (point.type !== 'Point' || point.metric !== 'activity_action_latency')
      continue;
    const { time, value, tags } = point.data;
    const timestamp = Date.parse(time);
    if (timestamp < start || timestamp > end) continue;
    eligible++;
    // Only locally generated diagnostic identities are permitted in Loki filters.
    if (
      !tags.requestId?.startsWith(`${runId}-vu`) ||
      !/^[A-Za-z0-9_.-]+-vu\d+-it\d+-r\d+$/.test(tags.requestId)
    ) {
      unmapped++;
      continue;
    }
    selected.push({
      requestId: tags.requestId,
      action: tags.action,
      outcome: tags.outcome,
      durationMs: value,
      endedAt: time,
      startedAt: new Date(timestamp - value).toISOString(),
    });
    selected.sort(
      (a, b) =>
        Number(b.outcome !== 'ok') - Number(a.outcome !== 'ok') ||
        b.durationMs - a.durationMs,
    );
    if (selected.length > limit) selected.pop();
  }
  return {
    selected,
    eligible,
    unmapped,
    limit,
    policy:
      'Errors first, then slowest post-warm-up actions; bounded sample, not exhaustive coverage',
  };
}
