import { describe, expect, it, vi } from 'vitest';

import {
  fetchRecentProjectAssistantReportContext,
  type ProjectAssistantReportEntityRef,
  type RecentProjectAssistantReportDeps,
} from '../recent-report-context';
import type { CodingResearchUpdate } from '../../../shared/api/generated/api';

const NOW = new Date('2026-06-30T12:00:00.000Z');

const logger = {
  info: vi.fn(),
  trace: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as RecentProjectAssistantReportDeps['logger'];

const jsonResponse = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const codingResearchReport = (overrides: {
  id?: string;
  createdAt: string;
  entities?: ProjectAssistantReportEntityRef[];
  linkedEntities?: Array<
    ProjectAssistantReportEntityRef | { entityType: 'FEATURE'; entityId: string }
  >;
  summary?: string;
  analysis?: string;
  updates?: CodingResearchUpdate[];
}) => ({
  id: overrides.id ?? 'report-1',
  reportType: 'CODING_RESEARCH',
  createdAt: overrides.createdAt,
  payload: {
    reportType: 'CODING_RESEARCH',
    summary: overrides.summary ?? 'Prior summary.',
    analysis: overrides.analysis ?? 'Prior analysis.',
    frame: { focalId: 'task-1', nodes: [] },
    provenance: { discoveryCalls: [], edgesTraversed: [] },
    updates: overrides.updates,
  },
  entities: overrides.entities,
  linkedEntities: overrides.linkedEntities,
});

const makeDeps = (
  fetchImpl: typeof fetch,
  overrides: Partial<RecentProjectAssistantReportDeps> = {},
): RecentProjectAssistantReportDeps => ({
  organizationId: 'org-1',
  projectId: 'proj-1',
  accessToken: 'token-1',
  apiBaseUrl: 'http://platform.test',
  fetchImpl,
  logger,
  now: () => NOW,
  ...overrides,
});

const createFetch = (reportsByEntityId: Record<string, object[]>, options?: { stale?: boolean }) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/organizations/org-1/reports') {
      return jsonResponse({
        data: reportsByEntityId[url.searchParams.get('entityId') ?? ''] ?? [],
      });
    }
    if (url.pathname.includes('/context')) {
      return jsonResponse({
        data: {
          createdAt: '2026-06-01T00:00:00.000Z',
          proposals: options?.stale
            ? [{ createdAt: '2026-06-30T11:00:00.000Z', updatedAt: '2026-06-30T11:10:00.000Z' }]
            : [],
        },
      });
    }
    if (url.pathname.endsWith('/agent-edges')) {
      return jsonResponse({
        content: options?.stale
          ? [
              {
                id: 'edge-1',
                createdAt: '2026-06-30T10:00:00.000Z',
                updatedAt: '2026-06-30T10:00:00.000Z',
              },
            ]
          : [],
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

describe('fetchRecentProjectAssistantReportContext', () => {
  it('injects a recent task-scoped report with a deterministic age note', async () => {
    const fetchImpl = createFetch({
      'task-1': [
        codingResearchReport({
          createdAt: '2026-06-30T09:00:00.000Z',
          entities: [{ entityType: 'TASK', entityId: 'task-1' }],
          summary: 'Task summary.',
          analysis: 'Task analysis.',
          updates: [
            {
              type: 'update',
              targets: [{ entityType: 'TASK', entityId: 'task-1', title: 'Task 1' }],
              description: 'Align the task with the report payload.',
              reason: 'The report boundary is missing the persisted candidate list.',
            },
          ],
        }),
      ],
    });

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    expect(result).toContain('created 3 hours ago');
    expect(result).toContain('prior research, not guaranteed-current state');
    expect(result).toContain('Task summary.');
    expect(result).toContain('Task analysis.');
    expect(result).toContain('### Reconciliation updates');
    expect(result).toContain('Align the task with the report payload.');
    expect(result).toContain('does not prove the report is fresh');
  });

  it('asks only for reusable reports so eval output is never offered as prior research', async () => {
    const fetchImpl = createFetch({ 'task-1': [] });

    await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    const reportListUrls = vi
      .mocked(fetchImpl)
      .mock.calls.map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/organizations/org-1/reports');
    expect(reportListUrls).toHaveLength(1);
    expect(reportListUrls[0]?.searchParams.get('ragEnabled')).toBe('true');
  });

  it('preserves an explicit empty updates array for a current report', async () => {
    const fetchImpl = createFetch({
      'task-1': [
        codingResearchReport({
          createdAt: '2026-06-30T09:00:00.000Z',
          entities: [{ entityType: 'TASK', entityId: 'task-1' }],
          updates: [],
        }),
      ],
    });

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    expect(result).toContain('### Reconciliation updates');
    expect(result).toContain('```json\n[]\n```');
  });

  it('injects a recent PLAN work-item report with a deterministic age note', async () => {
    const fetchImpl = createFetch({
      'plan-1': [
        codingResearchReport({
          createdAt: '2026-06-30T10:00:00.000Z',
          entities: [{ entityType: 'TASK', entityId: 'plan-1' }],
          summary: 'Plan summary.',
        }),
      ],
    });

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'plan-1' },
    ]);

    expect(result).toContain('created 2 hours ago');
    expect(result).toContain('Plan summary.');
  });

  it('ignores reports outside the recent window', async () => {
    const fetchImpl = createFetch({
      'task-1': [
        codingResearchReport({
          createdAt: '2026-06-29T11:00:00.000Z',
          entities: [{ entityType: 'TASK', entityId: 'task-1' }],
        }),
      ],
    });

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    expect(result).toBeNull();
  });

  it('warns when linked entity or direct edge activity is newer than the report', async () => {
    const fetchImpl = createFetch(
      {
        'task-1': [
          codingResearchReport({
            createdAt: '2026-06-30T09:00:00.000Z',
            entities: [{ entityType: 'TASK', entityId: 'task-1' }],
            linkedEntities: [{ entityType: 'TASK', entityId: 'plan-1' }],
          }),
        ],
      },
      { stale: true },
    );

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    expect(result).toContain('Advisory stale-context check found');
    expect(result).toContain('linked-entity timestamp(s)');
    expect(result).toContain('direct graph-edge timestamp(s)');
    expect(result).toContain('Treat the report as possibly stale');
  });

  it('does not discard a valid report when it links a non-task-plan entity', async () => {
    const fetchImpl = createFetch({
      'task-1': [
        codingResearchReport({
          createdAt: '2026-06-30T09:00:00.000Z',
          entities: [{ entityType: 'TASK', entityId: 'task-1' }],
          linkedEntities: [{ entityType: 'FEATURE', entityId: 'feature-1' }],
          summary: 'Report with a linked feature.',
        }),
      ],
    });

    const result = await fetchRecentProjectAssistantReportContext(makeDeps(fetchImpl), [
      { entityType: 'TASK', entityId: 'task-1' },
    ]);

    expect(result).toContain('Report with a linked feature.');
  });
});
