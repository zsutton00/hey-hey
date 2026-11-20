import { legacyStatuses } from '../../../../../../packages/ui-common/src/test/fixtures/workItemStatuses';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkItemTypeMonitorKind } from '@hey-hey/contracts/api/models';
import { parseEffectiveWorkItemTypeDefinition } from '../../prompts/work-item-type-registry';

const API_FLYWAY_DIR = resolve(__dirname, '../../../../../api/db/flyway');

const dollarQuotedJson = (file: string, tag: string): Record<string, unknown> => {
  const sql = readFileSync(resolve(API_FLYWAY_DIR, file), 'utf8');
  const literal = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql)?.[1];
  if (literal === undefined) throw new Error(`${file} publishes no $${tag}$ literal`);
  return JSON.parse(literal) as Record<string, unknown>;
};

/**
 * The kind the shipped API migrations publish on the canonical TASK_MONITOR template, in
 * migration order: the Task kind, then its policies for any key the kind does not declare.
 */
export const shippedTaskMonitorKind = (): WorkItemTypeMonitorKind => {
  const published = {
    ...dollarQuotedJson('V2026.11.16.102036__publish_monitor_acceptance_effects.sql', 'acceptance'),
    ...dollarQuotedJson('V2026.11.15.224545__publish_task_monitor_kind_policies.sql', 'policies'),
    ...dollarQuotedJson('V2026.11.13.064226__publish_task_monitor_task_kind.sql', 'kind'),
  };
  const kind = parseEffectiveWorkItemTypeDefinition(taskMonitorTypeBody('project', [published]))
    .capabilities?.monitorKinds?.[0];
  if (kind === undefined) throw new Error('shipped migrations publish no monitor kind');
  return kind;
};

/** A test-only non-Task configuration: no start transition, normalized results, direct acceptance. */
export const directResultKind = (): WorkItemTypeMonitorKind => ({
  ...shippedTaskMonitorKind(),
  key: 'requirement-check',
  allowedNodeTypes: ['BUG'],
  acceptance: { type: 'NO_STATUS_CHANGE' },
  start: { type: 'NO_STATUS_CHANGE' },
  done: { type: 'NORMALIZED_RESULT' },
  supervision: { type: 'DIRECT_ACCEPTANCE' },
});

/**
 * The kinds of a project that runs Task monitors beside a test-only direct-acceptance kind on the
 * one TASK_MONITOR type.
 */
export const mixedMonitorKinds = (): WorkItemTypeMonitorKind[] => [
  shippedTaskMonitorKind(),
  directResultKind(),
];

/** The API's `GET .../work-item-types/TASK_MONITOR` body for a project declaring `kinds`. */
export const taskMonitorTypeBody = (projectId: string, kinds: readonly object[] | undefined) => ({
  data: {
    id: 'c1a70000-0000-0000-0000-000000000007',
    definition: {
      key: 'TASK_MONITOR',
      name: 'Task Monitor',
      role: 'monitor',
      sections: [],
      statuses: legacyStatuses(['BACKLOG', 'READY', 'ACTIVE', 'ON_HOLD', 'VERIFYING', 'COMPLETED']),
      capabilities: {
        requiresParent: true,
        planEligible: false,
        ...(kinds === undefined ? {} : { monitorKinds: kinds }),
      },
    },
    status: 'ACTIVE',
    projectId,
    effectiveSource: 'CANONICAL',
  },
});

const TYPE_PATH = /\/projects\/([^/]+)\/work-item-types\/TASK_MONITOR$/u;
const TASK_TYPE_PATH = /\/projects\/[^/]+\/work-item-types\/(?:STANDARD|BUG)$/u;
const REPORTS_PATH = /\/organizations\/[^/]+\/reports\?/u;

/** A MONITOR_NODE_RESULT report a node's session has recorded, as the API lists it. */
export interface ServedNodeResult {
  readonly reportId: string;
  readonly agentSessionId: string;
  /** The payload as stored; use {@link nodeResultPayload} for a valid one. */
  readonly payload: unknown;
}

export const nodeResultPayload = (
  nodeId: string,
  outcome: 'ACCEPTED' | 'FAILED',
  reason = outcome === 'ACCEPTED' ? 'All requirement checks passed.' : 'Requirement check failed.',
) => ({
  reportType: 'MONITOR_NODE_RESULT',
  summary: `Node ${outcome.toLowerCase()}.`,
  nodeId,
  outcome,
  reason,
});

const reportListBody = (results: readonly ServedNodeResult[]) => ({
  success: true,
  data: results.map((result) => ({
    id: result.reportId,
    organizationId: '10000000-0000-4000-8000-000000000001',
    reportType: 'MONITOR_NODE_RESULT',
    audience: 'PROJECT_VISIBLE',
    title: 'Monitor Node Result',
    payload: result.payload,
    version: 1,
    schemaVersion: 1,
    createdAt: '2026-11-15T00:00:00.000Z',
    expiresAt: null,
    entities: [{ entityType: 'AGENT_SESSION', entityId: result.agentSessionId }],
  })),
});

/**
 * A fetch that answers each project's TASK_MONITOR type read with its effective kinds and each
 * session's node-result report list with `nodeResults` (listed in order, newest first), and
 * delegates every other request. Projects absent from `kinds` get the shipped canonical kinds.
 */
export const fetchServingMonitorKinds = (
  kinds: Readonly<Record<string, readonly WorkItemTypeMonitorKind[] | undefined>> = {},
  fallback: typeof fetch = () => Promise.reject(new Error('unexpected request')),
  nodeResults: readonly ServedNodeResult[] = [],
): typeof fetch =>
  ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (REPORTS_PATH.test(url)) {
      const query = new URL(url).searchParams;
      const sessionResults = nodeResults.filter(
        (result) =>
          query.get('reportType') === 'MONITOR_NODE_RESULT' &&
          query.get('entityType') === 'AGENT_SESSION' &&
          result.agentSessionId === query.get('entityId'),
      );
      return Promise.resolve(Response.json(reportListBody(sessionResults)));
    }
    if (TASK_TYPE_PATH.test(url)) {
      return Promise.resolve(
        Response.json({
          data: {
            definition: {
              statuses: legacyStatuses(['BACKLOG', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
            },
          },
        }),
      );
    }
    const projectId = TYPE_PATH.exec(url)?.[1];
    if (projectId === undefined) return fallback(input, init);
    const declared = projectId in kinds ? kinds[projectId] : [shippedTaskMonitorKind()];
    return Promise.resolve(Response.json(taskMonitorTypeBody(projectId, declared)));
  }) as typeof fetch;
