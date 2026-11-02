import { ReportUsageTrendGranularity as Granularity } from 'src/generated';
import type {
  ReportUsageBreakdownEntry,
  ReportUsageMeasurement,
} from 'src/generated';
import { OrganizationId } from 'src/types';
import {
  createMockDomainEventPublisher,
  createMockPrismaService,
} from 'src/utils/testUtils';
import { ReportService } from '../report.service';
import {
  aggregateUsageTrends,
  type UsageTrendQuery,
  type UsageTrendRow,
} from '../report-usage-trends';

type Figures = Pick<
  ReportUsageMeasurement,
  | 'inputTokens'
  | 'freshInputTokens'
  | 'cacheReadInputTokens'
  | 'cacheCreationInputTokens'
  | 'outputTokens'
  | 'toolCalls'
  | 'cacheAvailability'
  | 'coverage'
>;

const complete = (input: number, output: number, tools: number): Figures => ({
  inputTokens: input,
  freshInputTokens: input,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: output,
  toolCalls: tools,
  cacheAvailability: 'reported',
  coverage: 'complete',
});

const unavailable: Figures = {
  inputTokens: null,
  freshInputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  outputTokens: null,
  toolCalls: null,
  cacheAvailability: 'unreported',
  coverage: 'unavailable',
};

function row(
  executionId: string,
  capturedAt: string,
  figures: Figures,
  overrides: Partial<ReportUsageMeasurement> = {},
  reportType: UsageTrendRow['reportType'] = 'IMPLEMENT',
): UsageTrendRow {
  return {
    reportType,
    usage: {
      schemaVersion: 1,
      runId: 'run',
      agentSessionId: 'session',
      turnId: null,
      executionId,
      providerSessionId: null,
      provider: 'claude',
      model: 'opus',
      effort: 'high',
      capturedAt,
      breakdown: [],
      ...figures,
      ...overrides,
    },
  };
}

function entry(
  model: string,
  figures: Figures,
  overrides: Partial<ReportUsageBreakdownEntry> = {},
): ReportUsageBreakdownEntry {
  return {
    ...figures,
    executionId: 'e',
    providerSessionId: null,
    provider: 'claude',
    model,
    effort: 'high',
    role: 'parent',
    label: model,
    ...overrides,
  };
}

const query = (overrides: Partial<UsageTrendQuery> = {}): UsageTrendQuery => ({
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-12-01T00:00:00Z'),
  granularity: Granularity.Day,
  reportKinds: [],
  providers: [],
  models: [],
  efforts: [],
  ...overrides,
});

describe('aggregateUsageTrends', () => {
  it('counts an execution once using its latest cumulative snapshot', () => {
    const result = aggregateUsageTrends(
      [
        row('a', '2026-10-10T01:00:00Z', complete(100, 10, 2)),
        row('a', '2026-10-10T02:00:00Z', complete(300, 30, 6)),
      ],
      query(),
    );

    expect(result.executionCount).toBe(1);
    expect(result.totals.inputTokens).toBe(300);
    expect(result.averages).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      toolCalls: 6,
    });
  });

  it('averages complete executions only and reports partial and unavailable counts', () => {
    const partial: Figures = {
      ...complete(1000, 100, 50),
      coverage: 'partial',
    };
    const result = aggregateUsageTrends(
      [
        row('a', '2026-10-10T00:00:00Z', complete(100, 10, 0)),
        row('b', '2026-10-10T00:00:00Z', complete(300, 30, 4)),
        row('c', '2026-10-10T00:00:00Z', partial),
        row('d', '2026-10-10T00:00:00Z', unavailable),
      ],
      query(),
    );

    expect(result).toMatchObject({
      executionCount: 4,
      completeCount: 2,
      partialCount: 1,
      unavailableCount: 1,
      // measured zero tool calls stays valid in the average: (0 + 4) / 2
      averages: { inputTokens: 200, outputTokens: 20, toolCalls: 2 },
    });
    // totals sum measured figures only, partial included, unavailable adds nothing
    expect(result.totals.inputTokens).toBe(1400);
  });

  it('has null averages when no execution is complete', () => {
    const result = aggregateUsageTrends(
      [row('a', '2026-10-10T00:00:00Z', unavailable)],
      query(),
    );

    expect(result.averages).toEqual({
      inputTokens: null,
      outputTokens: null,
      toolCalls: null,
    });
    expect(result.unavailableCount).toBe(1);
  });

  it('keeps research, implementation and review distinct, walkthrough as review', () => {
    const rows = [
      row(
        'r',
        '2026-10-10T00:00:00Z',
        complete(1, 1, 1),
        {},
        'CODING_RESEARCH',
      ),
      row('i', '2026-10-10T00:00:00Z', complete(2, 1, 1), {}, 'IMPLEMENT'),
      row('v', '2026-10-10T00:00:00Z', complete(4, 1, 1), {}, 'REVIEW'),
      row(
        'w',
        '2026-10-10T00:00:00Z',
        complete(8, 1, 1),
        {},
        'CHANGE_WALKTHROUGH',
      ),
    ];

    expect(aggregateUsageTrends(rows, query()).options.reportKinds).toEqual([
      'IMPLEMENTATION',
      'RESEARCH',
      'REVIEW',
    ]);
    expect(
      aggregateUsageTrends(rows, query({ reportKinds: ['REVIEW'] })).totals
        .inputTokens,
    ).toBe(12);
  });

  it('keeps unknown effort and provider as their own filter values', () => {
    const rows = [
      row('a', '2026-10-10T00:00:00Z', complete(1, 1, 1), { effort: null }),
      row('b', '2026-10-10T00:00:00Z', complete(2, 1, 1)),
    ];

    const filtered = aggregateUsageTrends(
      rows,
      query({ efforts: ['unknown'] }),
    );

    expect(filtered.executionCount).toBe(1);
    expect(filtered.options.efforts).toEqual(['high', 'unknown']);
  });

  it('attributes a model filter to matching breakdown entries only', () => {
    const mixed = row('m', '2026-10-10T00:00:00Z', complete(1000, 100, 10), {
      breakdown: [
        entry('opus', complete(900, 90, 9)),
        entry('haiku', complete(100, 10, 1)),
      ],
    });

    const haiku = aggregateUsageTrends([mixed], query({ models: ['haiku'] }));
    const unfiltered = aggregateUsageTrends([mixed], query());

    expect(haiku.totals.inputTokens).toBe(100);
    expect(haiku.executionCount).toBe(1);
    expect(unfiltered.totals.inputTokens).toBe(1000);
    expect(unfiltered.options.models).toEqual(['haiku', 'opus']);
    expect(
      aggregateUsageTrends([mixed], query({ models: ['sonnet'] }))
        .executionCount,
    ).toBe(0);
  });

  it('buckets on UTC boundaries for day, ISO week and month', () => {
    const rows = [
      row('a', '2026-10-31T23:59:59Z', complete(1, 1, 1)),
      row('b', '2026-11-01T00:00:00Z', complete(1, 1, 1)),
      row('c', '2026-11-02T00:00:00Z', complete(1, 1, 1)),
    ];
    const starts = (granularity: UsageTrendQuery['granularity']) =>
      aggregateUsageTrends(rows, query({ granularity })).buckets.map(
        (bucket) => bucket.start,
      );

    expect(starts('day')).toEqual([
      '2026-10-31T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    ]);
    // Sunday 2026-11-01 belongs to the ISO week starting Monday 2026-10-26.
    expect(starts('week')).toEqual([
      '2026-10-26T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    ]);
    expect(starts('month')).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
  });

  it('excludes executions outside the period (end exclusive)', () => {
    const result = aggregateUsageTrends(
      [
        row('a', '2026-09-30T23:59:59Z', complete(1, 1, 1)),
        row('b', '2026-12-01T00:00:00Z', complete(1, 1, 1)),
        row('c', '2026-10-01T00:00:00Z', complete(1, 1, 1)),
      ],
      query(),
    );

    expect(result.executionCount).toBe(1);
  });
});

describe('delegated research and attribution filters', () => {
  const parent = row(
    'parent',
    '2026-10-10T02:00:00Z',
    complete(200, 20, 4),
    {
      breakdown: [
        entry('opus', complete(100, 10, 2), { executionId: 'parent' }),
        entry('gpt', complete(100, 10, 2), {
          executionId: 'child',
          provider: 'codex',
          effort: 'low',
          role: 'subagent',
        }),
      ],
    },
    'IMPLEMENT',
  );
  const childOwnReport = row(
    'child',
    '2026-10-10T01:00:00Z',
    complete(100, 10, 2),
    {
      provider: 'codex',
      model: 'gpt',
      effort: 'low',
      breakdown: [
        entry('gpt', complete(100, 10, 2), {
          executionId: 'child',
          provider: 'codex',
          effort: 'low',
          role: 'subagent',
        }),
      ],
    },
    'CODING_RESEARCH',
  );

  it('counts delegated research once, inside the launching parent', () => {
    const result = aggregateUsageTrends([parent, childOwnReport], query());

    expect(result.executionCount).toBe(1);
    expect(result.totals.inputTokens).toBe(200);
    expect(result.averages.inputTokens).toBe(200);
  });

  it('still counts a delegated research report whose parent never reported', () => {
    const result = aggregateUsageTrends([childOwnReport], query());

    expect(result.executionCount).toBe(1);
    expect(result.totals.inputTokens).toBe(100);
  });

  it('attributes provider and effort filters to the delegated contribution', () => {
    const codex = aggregateUsageTrends(
      [parent, childOwnReport],
      query({ providers: ['codex'] }),
    );
    const lowEffort = aggregateUsageTrends(
      [parent, childOwnReport],
      query({ efforts: ['low'] }),
    );

    expect(codex.executionCount).toBe(1);
    expect(codex.totals.inputTokens).toBe(100);
    expect(lowEffort.totals.inputTokens).toBe(100);
  });

  it('requires one contribution to match every selected attribution filter', () => {
    const mismatched = aggregateUsageTrends(
      [parent],
      query({ providers: ['claude'], models: ['gpt'] }),
    );
    const matched = aggregateUsageTrends(
      [parent],
      query({ providers: ['codex'], models: ['gpt'] }),
    );

    expect(mismatched.executionCount).toBe(0);
    expect(matched.totals.inputTokens).toBe(100);
  });
});

describe('ReportService.getUsageTrends', () => {
  const buildService = (reports: unknown[]) => {
    const prisma = createMockPrismaService();
    (prisma.db.report.findMany as jest.Mock).mockResolvedValue(reports);
    const service = new ReportService(
      prisma as any,
      createMockDomainEventPublisher() as any,
      { getEntitiesByIds: jest.fn().mockResolvedValue([]) } as any,
      { findActiveByConversation: jest.fn() } as any,
      { getNode: jest.fn() } as any,
    );
    return { prisma, service };
  };

  it('reads only user-visible, unexpired, usage-bearing project reports and skips invalid stored usage', async () => {
    const valid = row('a', '2026-10-10T00:00:00Z', complete(10, 1, 1)).usage;
    const { prisma, service } = buildService([
      { id: 'ok', reportType: 'IMPLEMENT', usage: valid },
      { id: 'bad', reportType: 'REVIEW', usage: { schemaVersion: 99 } },
    ]);

    const result = await service.getUsageTrends(
      'org-1' as OrganizationId,
      'project-1',
      query(),
    );

    expect(result.executionCount).toBe(1);

    const where = JSON.stringify(
      (prisma.db.report.findMany as jest.Mock).mock.calls[0][0].where,
    );
    expect(where).toContain('PROJECT_VISIBLE');
    expect(where).toContain('ORGANIZATION_VISIBLE');
    expect(where).not.toContain('WORKFLOW_ONLY');
    expect(where).toContain('expiresAt');
    expect(where).toContain('project-1');
  });
});
