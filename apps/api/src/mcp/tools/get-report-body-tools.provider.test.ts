import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { Context } from '@rekog/mcp-nest';
import { GetReportBodyToolsProvider } from './get-report-body-tools.provider';
import {
  ReportAudience,
  ReportDto,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  OtherReportPayload,
  ReportDtoOther,
} from '../../generated';
import { ReportService } from '../../services/reports/report.service';
import * as TestUtils from '../../utils/testUtils';

const EMPTY_CONTEXT = {} as unknown as Context;
const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const AGENT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174777';
const REPORT_ID = '123e4567-e89b-42d3-a456-426614174779';
const VALID_BUT_MISSING_REPORT_ID = '123e4567-e89b-42d3-a456-426614174780';

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

function makeReportDto(
  overrides?: Partial<ReportDtoOther>,
): ReportDtoOther {
  return {
    id: REPORT_ID,
    organizationId: testIds.organization,
    projectId: testIds.project,
    reportType: ReportType.SessionSummary,
    audience: ReportAudience.WorkflowOnly,
    title: 'Session Summary',
    payload: {
      reportType: ReportType.SessionSummary,
      text: 'Wrapped up the auth refactor.',
    } as OtherReportPayload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: AGENT_SESSION_ID,
    parentReportId: null,
    createdAt: '2026-04-26T12:00:00.000Z',
    expiresAt: '2026-05-26T12:00:00.000Z',
    entities: [
      {
        entityType: ReportRelatedEntityType.Task,
        entityId: testIds.task,
        relation: ReportEntityRelation.Primary,
        displayName: 'Refactor auth middleware',
        createdAt: '2026-04-26T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
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

describe('GetReportBodyToolsProvider', () => {
  let provider: GetReportBodyToolsProvider;
  let reportService: { findOne: jest.Mock };

  beforeEach(() => {
    reportService = { findOne: jest.fn() };
    provider = new GetReportBodyToolsProvider(
      reportService as unknown as ReportService,
    );
  });

  it('returns the full ReportDto JSON-stringified on success', async () => {
    const dto = makeReportDto();
    reportService.findOne.mockResolvedValue(dto);

    const result = await provider.getReportBody(
      { reportId: REPORT_ID },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(false);
    expect(reportService.findOne).toHaveBeenCalledTimes(1);
    expect(reportService.findOne).toHaveBeenCalledWith(
      testIds.organization,
      REPORT_ID,
    );

    const parsed = JSON.parse(firstText(asTextResult(result))) as ReportDto;
    expect(parsed).toEqual(dto);
    expect(parsed.payload).toEqual({
      reportType: ReportType.SessionSummary,
      text: 'Wrapped up the auth refactor.',
    });
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.sourceExecutionId).toBe(AGENT_SESSION_ID);
    expect(parsed.createdAt).toBe('2026-04-26T12:00:00.000Z');
    expect(parsed.audience).toBe(ReportAudience.WorkflowOnly);
  });

  it('returns an authorization-shaped mcpError when the service throws NotFoundException', async () => {
    reportService.findOne.mockRejectedValue(
      new NotFoundException('Report not found'),
    );

    const result = await provider.getReportBody(
      { reportId: VALID_BUT_MISSING_REPORT_ID },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    const text = firstText(result);
    expect(text).toContain(VALID_BUT_MISSING_REPORT_ID);
    expect(text).toContain('not found or not accessible');
  });

  it('returns an mcpError when the auth context is missing', async () => {
    const result = await provider.getReportBody(
      { reportId: REPORT_ID },
      EMPTY_CONTEXT,
      makeRequest({ user: undefined }),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    expect(firstText(result)).toContain('Authentication required');
    expect(reportService.findOne).not.toHaveBeenCalled();
  });

  it('still resolves on the happy path when X-Agent-Session-ID is absent (read-only callers are non-agent)', async () => {
    reportService.findOne.mockResolvedValue(makeReportDto());

    const result = await provider.getReportBody(
      { reportId: REPORT_ID },
      EMPTY_CONTEXT,
      makeRequest({ agentSessionHeader: null }),
    );

    expect(isCallToolError(result)).toBe(false);
    expect(reportService.findOne).toHaveBeenCalledWith(
      testIds.organization,
      REPORT_ID,
    );
  });

  it('rejects an unknown error from the service as a typed mcpError', async () => {
    reportService.findOne.mockRejectedValue(new Error('boom'));

    const result = await provider.getReportBody(
      { reportId: REPORT_ID },
      EMPTY_CONTEXT,
      makeRequest(),
    );

    expect(isCallToolError(result)).toBe(true);
    if (!isCallToolError(result)) return;
    expect(firstText(result)).toContain('boom');
  });
});
