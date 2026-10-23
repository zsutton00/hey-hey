import { describe, expect, it, vi } from 'vitest';
import type { ServerLogger } from '../logger';
import { EntityReportIndex } from './entity-report-index';
import { rehydrateReportIndex } from './rehydrate-index';

const createMockLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

type FetchResponder = (url: string) => {
  ok?: boolean;
  status?: number;
  data: unknown;
};

const createFetchImpl = (respond: FetchResponder, capturedUrls: string[]) =>
  vi.fn(async (url: string) => {
    capturedUrls.push(url);
    const { ok = true, status = 200, data } = respond(url);
    return {
      ok,
      status,
      text: async () => '',
      json: async () => ({ data }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

describe('rehydrateReportIndex', () => {
  it('fetches the most recent DAILY_SESSION and then its children', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = createFetchImpl((url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('reportType') === 'DAILY_SESSION') {
        return {
          data: [{ id: 'parent-1', reportType: 'DAILY_SESSION', entities: [] }],
        };
      }
      return { data: [] };
    }, requestedUrls);

    await rehydrateReportIndex({
      index: new EntityReportIndex(),
      organizationId: 'org-1',
      projectId: 'proj-1',
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      fetchImpl,
      logger: createMockLogger(),
    });

    expect(requestedUrls).toHaveLength(2);

    const parentUrl = new URL(requestedUrls[0]!);
    expect(parentUrl.pathname).toBe('/organizations/org-1/reports');
    expect(parentUrl.searchParams.get('projectId')).toBe('proj-1');
    expect(parentUrl.searchParams.get('reportType')).toBe('DAILY_SESSION');
    expect(parentUrl.searchParams.get('sortBy')).toBe('createdAt');
    expect(parentUrl.searchParams.get('sortOrder')).toBe('DESC');
    expect(parentUrl.searchParams.get('limit')).toBe('1');

    const childrenUrl = new URL(requestedUrls[1]!);
    expect(childrenUrl.pathname).toBe('/organizations/org-1/reports');
    expect(childrenUrl.searchParams.get('projectId')).toBe('proj-1');
    expect(childrenUrl.searchParams.get('parentReportId')).toBe('parent-1');
  });

  it('registers entity refs for each child report', async () => {
    const fetchImpl = createFetchImpl((url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('reportType') === 'DAILY_SESSION') {
        return {
          data: [{ id: 'parent-1', reportType: 'DAILY_SESSION', entities: [] }],
        };
      }
      return {
        data: [
          {
            id: 'rpt-goal',
            reportType: 'GOAL_PROGRESS',
            entities: [{ entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' }],
          },
          {
            id: 'rpt-risk',
            reportType: 'RISK_ALERT',
            entities: [
              { entityType: 'TASK', entityId: 'task-2', relation: 'PRIMARY' },
              { entityType: 'FEATURE', entityId: 'feat-1', relation: 'PRIMARY' },
            ],
          },
        ],
      };
    }, []);

    const index = new EntityReportIndex();
    const result = await rehydrateReportIndex({
      index,
      organizationId: 'org-1',
      projectId: 'proj-1',
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      fetchImpl,
      logger: createMockLogger(),
    });

    expect(result.reportCount).toBe(2);
    expect(result.entityCount).toBe(3);
    expect(index.lookupReports('TASK', 'task-1')).toContain('rpt-goal');
    expect(index.lookupReports('TASK', 'task-2')).toContain('rpt-risk');
    expect(index.lookupReports('FEATURE', 'feat-1')).toContain('rpt-risk');
  });

  it('returns zero counts and does not fetch children when no parent exists', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = createFetchImpl(() => ({ data: [] }), requestedUrls);

    const result = await rehydrateReportIndex({
      index: new EntityReportIndex(),
      organizationId: 'org-1',
      projectId: 'proj-1',
      accessToken: 'token',
      apiBaseUrl: 'https://api.test',
      fetchImpl,
      logger: createMockLogger(),
    });

    expect(requestedUrls).toHaveLength(1);
    expect(result).toEqual({ reportCount: 0, entityCount: 0 });
  });
});
