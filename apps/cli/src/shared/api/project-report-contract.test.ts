import { describe, expect, it } from 'vitest';

import {
  ProjectReportsApiAxiosParamCreator,
  type CreateProjectReportRequestDto,
  type RunCreatePayloadProjectReport as ApiLaunch,
} from './generated/api';
import type { RunCreatePayloadProjectReport as BridgeLaunch } from '../agent-bridge-contract/generated/api';

const organizationId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';

const toBridge = (value: ApiLaunch): BridgeLaunch => value;

describe('generated project report contracts', () => {
  it('preserves the reviewed submission in CLI transport', async () => {
    const request = {
      question: 'What changed?',
      scope: {
        projectId,
        windowStart: '2026-09-21T00:00:00Z',
        windowEnd: '2026-09-28T00:00:00Z',
        timeZone: 'UTC',
      },
      exclusions: [{ entityType: 'TASK', entityId: requestId }],
      launch: {
        machineId: attemptId,
        provider: 'codex',
        model: 'configured-model',
        effort: 'high',
        fastMode: false,
      },
      idempotencyKey: 'submission-one',
    } satisfies CreateProjectReportRequestDto;
    const params = await ProjectReportsApiAxiosParamCreator().createProjectReportRequest(
      organizationId,
      projectId,
      request,
    );
    expect(params.url).toBe(
      `/organizations/${organizationId}/projects/${projectId}/project-report-requests`,
    );
    expect(params.options.method).toBe('POST');
    expect(JSON.parse(params.options.data as string)).toEqual(request);
  });

  it('binds each bounded evidence page to the request and exact execution attempt', async () => {
    const params = await ProjectReportsApiAxiosParamCreator().getProjectReportActivityPage(
      organizationId,
      projectId,
      requestId,
      attemptId,
      50,
      100,
    );
    expect(params.url).toContain(`/${requestId}/activity?`);
    expect(params.url).toContain(`attemptId=${attemptId}`);
    expect(params.url).toContain('limit=50');
    expect(params.url).toContain('offset=100');
    expect(
      toBridge({ promptType: 'project_report', request: { requestId, attemptId, projectId } }),
    ).toEqual({
      promptType: 'project_report',
      request: { requestId, attemptId, projectId },
    });
  });
});
