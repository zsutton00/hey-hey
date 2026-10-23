import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { Context } from '@rekog/mcp-nest';
import { ListReportsByEntityToolsProvider } from './list-reports-by-entity-tools.provider';
import { ReportSummaryDto, ReportType } from '../../generated';
import { ReportService } from '../../services/reports/report.service';
import * as TestUtils from '../../utils/testUtils';

const EMPTY_CONTEXT = {} as unknown as Context;
const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const AGENT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174777';
const ENTITY_ID = '123e4567-e89b-42d3-a456-426614174781';

type RequestOverrides = {
  token?: string | null;
  user?: unknown;
  agentSessionHeader?: string | null;
};

function makeRequest(overrides?: RequestOverrides): Request {
  const token = overrides?.token === undefined ? TEST_TOKEN : overrides.token;
  const user =
    overrides && 'user' in overrides
      ? overrides.user
      : {
          userId: testIds.user,
          currentOrgId: testIds.organization,
        };
  const headers: Record<string, string> = {};
  const sessionHeader =
    overrides?.agentSessionHeader === undefined
      ? AGENT_SESSION_ID
      : overrides.agentSessionHeader;
  if (sessionHeader) headers['x-agent-session-id'] = sessionHeader;
  if (token) headers.authorization = `Bearer ${token}`;
  return { user, headers } as unknown as Request;
}

function makeSummaries(): ReportSummaryDto[] {
  return [
    {
      id: '123e4567-e89b-42d3-a456-426614174782',
      reportType: ReportType.Implement,
      sourceExecution: '123e4567-e89b-42d3-a456-426614174783',
      createdAt: '2026-04-26T12:00:00.000Z',
    },
    {
      id: '123e4567-e89b-42d3-a456-426614174784',
      reportType: ReportType.Plan,
      sourceExecution: null,
      createdAt: '2026-04-25T12:00:00.000Z',
    },
  ];
}

function isCallToolError(value: unknown): value is {
  isError: true;
  content: Array<{ type: string; text: string }>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isError?: unknown }).isError === true
  );
}

function firstText(result: {
  content: Array<{ type: string; text: string }>;
}): string {
  const first = result.content[0];
  if (!first) throw new Error('Expected at least one content entry');
  return first.text;
}

function asTextResult(result: unknown): {
  content: Array<{ type: string; text: string }>;
} {
  return result as {
    content: Array<{ type: string; text: string }>;
  };
}

describe('ListReportsByEntityToolsProvider', () => {
  let provider: ListReportsByEntityToolsProvider;
  let reportService: { listSummariesByEntity: jest.Mock };

  beforeEach(() => {
    reportService = { listSummariesByEntity: jest.fn() };
    provider = new ListReportsByEntityToolsProvider(
      reportService as unknown as ReportService,
    );
  });

  it('returns the JSON-stringified ReportSummaryDto[] on success', async () => {
    const summaries = makeSummaries();
    reportService.listSummariesByEntity.mockResolvedValue(summaries);

    const result = await provider.listReportsByEntity(
      { entityId: ENTITY_ID },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(false);
    expect(reportService.listSummariesByEntity).toHaveBeenCalledWith(
      testIds.organization,
      ENTITY_ID,
      undefined,
    );

    const parsed = JSON.parse(
      firstText(asTextResult(result)),
    ) as ReportSummaryDto[];
    expect(parsed).toEqual(summaries);
  });

  it('forwards the reportType filter when supplied', async () => {
    reportService.listSummariesByEntity.mockResolvedValue([]);

    await provider.listReportsByEntity(
      { entityId: ENTITY_ID, reportType: ReportType.Implement },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(reportService.listSummariesByEntity).toHaveBeenCalledWith(
      testIds.organization,
      ENTITY_ID,
      ReportType.Implement,
    );
  });

  it('returns the BadRequestException message as a typed mcpError', async () => {
    reportService.listSummariesByEntity.mockRejectedValue(
      new BadRequestException('reportType must be one of: ...'),
    );

    const result = await provider.listReportsByEntity(
      { entityId: ENTITY_ID, reportType: 'NOT_A_REPORT_TYPE' },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    expect(firstText(result)).toContain('reportType must be one of');
  });

  it('returns an mcpError when the auth context is missing', async () => {
    const result = await provider.listReportsByEntity(
      { entityId: ENTITY_ID },
      EMPTY_CONTEXT,
      makeRequest({ user: undefined }),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    expect(firstText(result)).toContain('Authentication required');
    expect(reportService.listSummariesByEntity).not.toHaveBeenCalled();
  });

  it('rejects an unknown service error as a typed mcpError', async () => {
    reportService.listSummariesByEntity.mockRejectedValue(new Error('boom'));

    const result = await provider.listReportsByEntity(
      { entityId: ENTITY_ID },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    expect(firstText(result)).toContain('boom');
  });
});
