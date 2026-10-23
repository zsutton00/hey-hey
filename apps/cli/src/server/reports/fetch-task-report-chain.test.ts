import { describe, expect, it, vi } from 'vitest';

import { fetchTaskReportChain } from './fetch-task-report-chain';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const deps = (data: unknown) => ({
  organizationId: 'org-1',
  projectId: 'project-1',
  accessToken: 'token',
  apiBaseUrl: 'https://api.example.test',
  fetchImpl: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as typeof fetch,
  logger: logger as never,
});

describe('fetchTaskReportChain', () => {
  it('drops malformed report records at the REST boundary', async () => {
    const reports = await fetchTaskReportChain(
      deps([
        { id: 'missing-required-fields' },
        {
          id: 'bad-payload',
          reportType: 'IMPLEMENT',
          createdAt: '2026-07-17T00:00:00.000Z',
          payload: 'not-an-object',
        },
      ]),
      'task-1',
    );

    expect(reports).toEqual([]);
  });
});
