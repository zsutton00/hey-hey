import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { LOCAL_PROJECT } from './compose';
import { safeStartupCause, startupErrorCodes } from './startup-diagnostic-boundary';

const execute = promisify(execFile);
const limits = { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' as const };
const SERVICES = ['api', 'ui', 'postgres', 'redis', 'graph-search'] as const;
const MAX_CONTAINERS_PER_SERVICE = 2;
const TAIL_LINES = 500;
const MAX_EVENT_GROUPS = 20;
const SINCE = '2h';

const containerRow = z.object({
  id: z.string().regex(/^[a-f0-9]{6,64}$/u),
  service: z.enum(SERVICES),
});
// Only identifiers and cause codes survive; messages, stacks and request content never do.
const structuredLine = z.object({
  timestamp: z.string().datetime().optional().catch(undefined),
  level: z.enum(['info', 'warn', 'error', 'fatal']),
  event: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/u)
    .optional()
    .catch(undefined),
  component: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/u)
    .optional()
    .catch(undefined),
  reasonCode: z
    .enum([
      'refresh_cookie_missing',
      'not_found',
      'revoked',
      'inactive',
      'absolutely_expired',
      'replay_detected',
      'poll_interval_too_short',
      'poll_update_conflict',
    ])
    .optional()
    .catch(undefined),
  requestId: z.string().uuid().optional().catch(undefined),
  errorCode: z.unknown().optional(),
  statusCode: z.number().int().min(100).max(599).optional().catch(undefined),
  eventType: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/u)
    .optional()
    .catch(undefined),
  error: z.unknown().optional(),
  code: z.unknown().optional(),
});
const sessionEvents = new Set([
  'browser_session.established',
  'browser_session.refreshed',
  'browser_session.replacement_invalidation',
  'browser_session.passkey_change_committed',
  'browser_session.replacement_cookies_set',
  'browser_session.refresh_cookies_set',
  'browser_session.refresh_cookies_cleared',
  'browser_session.refresh_refused',
  'browser_session_eviction_applied',
]);
const causeCodePattern = new RegExp(`\\b(${startupErrorCodes.join('|')})\\b`, 'gu');

interface EventGroup {
  level: string;
  event: string | undefined;
  cause: unknown;
  count: number;
  reasonCode: string | undefined;
  requestId: string | undefined;
  firstAt: string | undefined;
  lastAt: string | undefined;
}

function summarizeLogs(output: string) {
  const lines = output.split('\n').filter((line) => line.trim());
  const groups = new Map<string, EventGroup>();
  const codes = new Map<string, number>();
  let omittedEventGroups = 0;
  let unstructuredLines = 0;
  let otherStructuredLines = 0;

  for (const line of lines.slice(-TAIL_LINES)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      unstructuredLines += 1;
      for (const [code] of line.matchAll(causeCodePattern)) {
        codes.set(code, (codes.get(code) ?? 0) + 1);
      }
      continue;
    }

    const parsed = structuredLine.safeParse(value);
    if (!parsed.success) {
      otherStructuredLines += 1;
      continue;
    }

    const { level, timestamp } = parsed.data;
    const event = parsed.data.event ?? parsed.data.eventType ?? parsed.data.component;
    if (level === 'info' && !sessionEvents.has(event ?? '')) {
      otherStructuredLines += 1;
      continue;
    }
    const raw = parsed.data.error ?? parsed.data.errorCode ?? parsed.data.code;
    const cause =
      raw === undefined && parsed.data.statusCode === undefined
        ? undefined
        : safeStartupCause(parsed.data.error ?? { code: raw, status: parsed.data.statusCode });
    const key = JSON.stringify([level, event, cause, parsed.data.reasonCode]);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.lastAt = timestamp ?? group.lastAt;
      continue;
    }
    if (groups.size >= MAX_EVENT_GROUPS) {
      omittedEventGroups += 1;
      const informational = [...groups].find(([, existing]) => existing.level === 'info');
      if (level === 'info' || !informational) {
        continue;
      }
      groups.delete(informational[0]);
    }
    groups.set(key, {
      level,
      event,
      cause,
      count: 1,
      firstAt: timestamp,
      lastAt: timestamp,
      reasonCode: parsed.data.reasonCode,
      requestId: parsed.data.requestId,
    });
  }

  return {
    scannedLines: Math.min(lines.length, TAIL_LINES),
    potentiallyTruncated: lines.length >= TAIL_LINES,
    unstructuredLines,
    otherStructuredLines,
    unstructuredCauseCodes: Object.fromEntries(codes),
    eventGroups: [...groups.values()],
    omittedEventGroups,
  };
}

async function discoverContainers() {
  const listing = await execute(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${LOCAL_PROJECT}`,
      '--format',
      '{{.ID}} {{.Label "com.docker.compose.service"}}',
    ],
    limits,
  );
  const rows = listing.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [id, service] = line.trim().split(' ');
      return containerRow.safeParse({ id, service });
    });
  return {
    containers: rows.flatMap((row) => (row.success ? [row.data] : [])),
    unrecognizedRows: rows.filter((row) => !row.success).length,
  };
}

/**
 * Bounded evidence about why a launch failed inside a container: warning-or-worse log events
 * reduced to identifiers and cause codes, plus the closed-vocabulary codes found in raw output.
 * Always returns records, including the specific reason when nothing could be collected.
 */
export async function collectLocalStartupContainerDiagnostics(): Promise<
  Array<Record<string, unknown>>
> {
  let discovered: Awaited<ReturnType<typeof discoverContainers>>;
  try {
    discovered = await discoverContainers();
  } catch (error) {
    const cause = safeStartupCause(error);
    return [
      {
        kind: 'local_startup_collection',
        reasonCode: cause.code === 'ENOENT' ? 'docker_unavailable' : 'docker_discovery_failed',
        error: cause,
      },
    ];
  }

  if (discovered.containers.length === 0) {
    return [{ kind: 'local_startup_collection', reasonCode: 'containers_absent' }];
  }

  const records: Array<Record<string, unknown>> = [];
  const perService = new Map<string, number>();
  let omittedContainers = 0;
  for (const { id, service } of discovered.containers) {
    const containerIndex = perService.get(service) ?? 0;
    if (containerIndex >= MAX_CONTAINERS_PER_SERVICE) {
      omittedContainers += 1;
      continue;
    }
    perService.set(service, containerIndex + 1);
    try {
      const output = await execute(
        'docker',
        ['logs', '--since', SINCE, '--tail', String(TAIL_LINES), id],
        limits,
      );
      records.push({
        kind: 'local_startup_container',
        service,
        containerIndex,
        since: SINCE,
        tailLines: TAIL_LINES,
        ...summarizeLogs(`${output.stdout}\n${output.stderr}`),
      });
    } catch (error) {
      records.push({
        kind: 'local_startup_container',
        service,
        containerIndex,
        reasonCode: 'container_collection_failed',
        error: safeStartupCause(error),
        evidenceIncomplete: true,
      });
    }
  }

  records.push({
    kind: 'local_startup_collection',
    reasonCode: 'collected',
    containerCount: discovered.containers.length,
    omittedContainers,
    unrecognizedContainers: discovered.unrecognizedRows,
  });
  return records;
}
