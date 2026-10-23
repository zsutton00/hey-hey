import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateReportProxy, CreateReportProxyError } from './create-report-proxy';
import { CreateReportTool } from './create-report-tool';
import { ReportEmissionEvents, type ReportEmissionListener } from './report-emission-events';
import { SubmissionToolAuth } from './submission-tool-auth';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';
import { jointDecision } from '../feature-sync/__tests__/feature-sync-decision.fixtures';
import type { Run } from '../../run/run';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { ProjectReportCoverage, ProjectReportEvidenceReference } from '../../shared/api/generated/api';
import { serializeProjectReportPreparedEvidence } from '../project-report/project-report-submission';
import type { ProjectReportEvidenceResult } from '../project-report/project-report-evidence-reader';

vi.mock('../../auth/index', () => ({
  extractOrganizationIdFromToken: (token: string) =>
    token.startsWith('token-with-org:') ? token.split(':')[1] : null,
}));

const reportGuidance = {
  actions: ['continue', 'stop'],
} as const;

const jsonResponse = (body: Record<string, unknown>, status = 201): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeFetch = (response: Response): typeof fetch =>
  vi.fn().mockResolvedValue(response) as unknown as typeof fetch;

const makeSubmissionToolAuth = (token: string): SubmissionToolAuth =>
  new SubmissionToolAuth(createProviderTestOAuthClient({ success: true, data: token }));

const makeReportEmissionEvents = (listener?: ReportEmissionListener): ReportEmissionEvents => {
  const events = new ReportEmissionEvents();
  if (listener) {
    events.subscribe(listener);
  }
  return events;
};

const PROJECT_REPORT_REQUEST_ID = '11111111-2222-4222-8222-111111111111';
const PROJECT_REPORT_ATTEMPT_ID = '33333333-4444-4444-8444-333333333333';
const PROJECT_REPORT_PROJECT_ID = '55555555-6666-4666-8666-555555555555';

const PREPARED_STARTED_AT = '2026-09-08T00:00:10.000Z';
const PREPARED_COMPLETED_AT = '2026-09-08T00:00:20.000Z';

const makeProjectReportRun = (
  coverage: ProjectReportCoverage = {
    status: 'COMPLETE',
    matchingActivityCount: 4,
    processedActivityCount: 4,
    pagesRead: 1,
    limitations: [],
  },
): Run =>
  ({
    session: {
      sessionContext: serializeProjectReportPreparedEvidence({
        requestId: PROJECT_REPORT_REQUEST_ID,
        attemptId: PROJECT_REPORT_ATTEMPT_ID,
        evidence: {
          evidenceReadStartedAt: PREPARED_STARTED_AT,
          evidenceReadCompletedAt: PREPARED_COMPLETED_AT,
          coverage,
        } as ProjectReportEvidenceResult,
      }),
      agentic_session_id: '77777777-8888-4888-8888-777777777777',
      promptType: LocalPromptType.ProjectReport,
      provider_session_id: 'provider-session-project-report',
      contextMetadata: { projectId: PROJECT_REPORT_PROJECT_ID },
      config: {
        type: 'PROJECT_REPORT',
        version: 'v1',
        requestId: PROJECT_REPORT_REQUEST_ID,
        attemptId: PROJECT_REPORT_ATTEMPT_ID,
        model: 'gpt-5.6-sol',
        effort: 'high',
      },
    },
    projectId: PROJECT_REPORT_PROJECT_ID,
    conversationId: '99999999-aaaa-4aaa-8aaa-999999999999',
    appendReportChainEntry: vi.fn(),
  }) as unknown as Run;

const makeProjectReportArgs = () => ({
  reportType: 'PROJECT_REPORT',
  audience: 'PROJECT_VISIBLE',
  payload: {
    reportType: 'PROJECT_REPORT',
    title: 'Project activity',
    summary: 'A short evidence-backed summary.',
    question: 'What changed?',
    scope: {
      projectId: PROJECT_REPORT_PROJECT_ID,
      windowStart: '2026-09-01T00:00:00.000Z',
      windowEnd: '2026-09-08T00:00:00.000Z',
      timeZone: 'UTC',
    },
    exclusions: [],
    provenance: {
      requestId: PROJECT_REPORT_REQUEST_ID,
      attemptId: PROJECT_REPORT_ATTEMPT_ID,
      evidenceReadStartedAt: '2026-09-08T00:00:00.000Z',
      evidenceReadCompletedAt: '2026-09-08T00:01:00.000Z',
      evidence: [],
    },
    coverage: {
      status: 'COMPLETE',
      matchingActivityCount: 4,
      processedActivityCount: 4,
      pagesRead: 1,
      limitations: [] as string[],
    },
    body: { html: '<main>Report</main>', css: '' },
  },
});

const sentPayload = (create: ReturnType<typeof vi.fn<CreateReportProxy['create']>>) => {
  const [call] = create.mock.calls;
  if (!call) throw new Error('Expected create_report to be proxied');
  return call[0].args['payload'] as Record<string, unknown>;
};

const restResult = (
  reportId: string,
  overrides: {
    guidance?: Record<string, unknown>;
    mention?: string;
  } = {},
) =>
  jsonResponse({
    success: true,
    data: {
      id: reportId,
      ...(overrides.mention !== undefined ? { mention: overrides.mention } : {}),
    },
    reportGuidance: overrides.guidance ?? reportGuidance,
  });

describe('CreateReportProxy', () => {
  it('preserves schemaVersion 2 and grouped choices in the REST body', async () => {
    const fetchImpl = makeFetch(restResult('report-grouped'));
    const listener = vi.fn();
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(listener),
    });
    await proxy.create({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      args: {
        reportType: 'FEATURE_SYNC_DECISION',
        audience: 'PROJECT_VISIBLE',
        schemaVersion: 2,
        payload: jointDecision,
      },
    });
    const init = vi.mocked(fetchImpl).mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toEqual({
      reportType: 'FEATURE_SYNC_DECISION',
      audience: 'PROJECT_VISIBLE',
      schemaVersion: 2,
      payload: jointDecision,
      projectId: 'proj-1',
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('posts to the platform report REST endpoint with auth, context headers, and the report payload', async () => {
    const fetchImpl = makeFetch(restResult('report-9'));

    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    const result = await proxy.create({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      args: {
        reportType: 'SESSION_SUMMARY',
        audience: 'WORKFLOW_ONLY',
        payload: { summary: 'x' },
        agent: 'provider-session-1',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/api/v1/organizations/org-42/reports');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-with-org:org-42',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Organization-ID': 'org-42',
        'X-Agent-Session-ID': 'run-1',
        'X-Conversation-ID': 'conv-1',
        'X-Project-ID': 'proj-1',
      },
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      reportType: 'SESSION_SUMMARY',
      audience: 'WORKFLOW_ONLY',
      payload: { summary: 'x' },
      agent: 'provider-session-1',
      projectId: 'proj-1',
    });

    expect(result.reportId).toBe('report-9');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          reportId: 'report-9',
          mention: '@[report:report-9|Report]',
          reportGuidance,
        }),
      },
    ]);
  });

  it('preserves a server-provided mention in the agent-facing content/result', async () => {
    const fetchImpl = makeFetch(
      restResult('report-msg', {
        mention: '@[report:report-msg|Custom Report]',
      }),
    );
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1/',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    const result = await proxy.create({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      args: { reportType: 'SESSION_SUMMARY', audience: 'WORKFLOW_ONLY', payload: { summary: 'x' } },
    });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          reportId: 'report-msg',
          mention: '@[report:report-msg|Custom Report]',
          reportGuidance,
        }),
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/organizations/org-1/reports',
      expect.any(Object),
    );
  });

  it('accepts the legacy top-level create_report response shape from the REST endpoint', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        reportId: 'report-legacy-shape',
        mention: '@[report:report-legacy-shape|Legacy Shape]',
        reportGuidance,
      }),
    );
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    const result = await proxy.create({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      args: { reportType: 'SESSION_SUMMARY', audience: 'WORKFLOW_ONLY', payload: { summary: 'x' } },
    });

    expect(result.reportId).toBe('report-legacy-shape');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          reportId: 'report-legacy-shape',
          mention: '@[report:report-legacy-shape|Legacy Shape]',
          reportGuidance,
        }),
      },
    ]);
  });

  it('throws MISSING_ORGANIZATION_ID before issuing a REST request when the token carries no org', async () => {
    const fetchImpl = makeFetch(restResult('unused'));
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).rejects.toMatchObject({
      name: 'CreateReportProxyError',
      code: 'MISSING_ORGANIZATION_ID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws TOOL_ERROR when the platform returns a non-2xx response', async () => {
    const fetchImpl = makeFetch(new Response('invalid args', { status: 400 }));
    const onReportEmitted = vi.fn();
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(onReportEmitted),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).rejects.toMatchObject({
      name: 'CreateReportProxyError',
      code: 'TOOL_ERROR',
      message: 'Platform create_report returned HTTP 400',
    });
    expect(onReportEmitted).not.toHaveBeenCalled();
  });

  it('includes validated platform rejection reasons', async () => {
    const proxy = new CreateReportProxy({
      fetchImpl: makeFetch(
        jsonResponse(
          {
            success: false,
            message: 'payload.body: required',
            statusCode: 400,
            timestamp: '2026-10-03T06:00:00Z',
            data: null,
          },
          400,
        ),
      ),
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });
    await expect(
      proxy.create({ runId: 'r', conversationId: 'c', projectId: 'p', args: {} }),
    ).rejects.toThrow('Platform create_report returned HTTP 400: payload.body: required');
  });

  it.each([true, false])(
    'accepts a completed attempt only when provenance matches: %s',
    async (matches) => {
      const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const attemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const proxy = new CreateReportProxy({
        fetchImpl: makeFetch(
          jsonResponse(
            {
              success: false,
              message: 'Already saved',
              statusCode: 409,
              timestamp: '2026-10-03T06:00:00Z',
              code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
              data: { code: 'PROJECT_REPORT_ATTEMPT_COMPLETED', requestId, attemptId, reportId },
            },
            409,
          ),
        ),
        auth: makeSubmissionToolAuth('token-with-org:org-1'),
        apiBaseUrl: 'http://localhost:3000/api/v1',
        reportEmissionEvents: makeReportEmissionEvents(),
      });
      const result = proxy.create({
        runId: 'r',
        conversationId: 'c',
        projectId: 'p',
        args: {
          reportType: 'PROJECT_REPORT',
          payload: { provenance: { requestId, attemptId: matches ? attemptId : requestId } },
        },
      });
      if (matches) await expect(result).resolves.toMatchObject({ reportId });
      else await expect(result).rejects.toMatchObject({ code: 'TOOL_ERROR' });
    },
  );

  it('throws MISSING_REPORT_ID when the parsed REST response omits the report id', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        success: true,
        data: {},
        reportGuidance,
      }),
    );
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).rejects.toMatchObject({ code: 'MISSING_REPORT_ID' });
  });

  it('accepts a successful REST response that omits reportGuidance', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ success: true, data: { id: 'report-no-guidance' } }),
    );
    const onReportEmitted = vi.fn();
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(onReportEmitted),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).resolves.toMatchObject({ reportId: 'report-no-guidance' });
    expect(onReportEmitted).toHaveBeenCalledWith({ runId: 'r', reportId: 'report-no-guidance' });
  });

  it('throws INVALID_RESPONSE when the REST body is not JSON', async () => {
    const fetchImpl = makeFetch(new Response('not json at all', { status: 201 }));
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('publishes one neutral report locator after successful REST persistence', async () => {
    const fetchImpl = makeFetch(restResult('report-7'));
    const onReportEmitted = vi.fn();
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(onReportEmitted),
    });

    await proxy.create({ runId: 'run-1', conversationId: 'conv-1', projectId: 'proj-1', args: {} });

    expect(onReportEmitted).toHaveBeenCalledTimes(1);
    expect(onReportEmitted).toHaveBeenCalledWith({
      runId: 'run-1',
      reportId: 'report-7',
    });
  });

  it('keeps a persisted report successful when a local emission listener throws', async () => {
    const fetchImpl = makeFetch(restResult('report-persisted'));
    const events = makeReportEmissionEvents(() => {
      throw new Error('monitor listener unavailable');
    });
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: events,
    });

    await expect(
      proxy.create({
        runId: 'run-1',
        conversationId: 'conversation-1',
        projectId: 'project-1',
        args: { reportType: 'PROJECT_REPORT', audience: 'PROJECT_VISIBLE', payload: {} },
      }),
    ).resolves.toMatchObject({ reportId: 'report-persisted' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('limits a project-report attempt to one correctly bound PROJECT_REPORT write', async () => {
    let resolveFirstSubmission:
      | ((result: Awaited<ReturnType<CreateReportProxy['create']>>) => void)
      | undefined;
    const create = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<CreateReportProxy['create']>>>((resolve) => {
          resolveFirstSubmission = resolve;
        }),
    );
    const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
    const run = makeProjectReportRun();
    const context = { runId: run.session.agentic_session_id, run, args: makeProjectReportArgs() };

    const firstSubmission = tool.execute(context);
    expect(create).toHaveBeenCalledOnce();
    await expect(
      tool.execute({ ...context, args: { ...context.args, reportType: 'SESSION_SUMMARY' } }),
    ).rejects.toThrow(/PROJECT_REPORT payload bound to this request, attempt, and project/);
    await expect(tool.execute(context)).rejects.toThrow(/one create_report submission/);
    expect(create).toHaveBeenCalledOnce();

    const completeFirstSubmission = resolveFirstSubmission;
    if (!completeFirstSubmission) throw new Error('Expected the first submission to be pending');
    completeFirstSubmission({ content: [], reportId: 'project-report-1' });
    await firstSubmission;
  });

  it('rejects a project report whose provenance does not match the active request attempt', async () => {
    const create = vi.fn();
    const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
    const run = makeProjectReportRun();
    const args = makeProjectReportArgs();
    args.payload.provenance.attemptId = PROJECT_REPORT_REQUEST_ID;

    await expect(
      tool.execute({ runId: run.session.agentic_session_id, run, args }),
    ).rejects.toThrow(/PROJECT_REPORT payload bound to this request, attempt, and project/);
    expect(create).not.toHaveBeenCalled();
  });

  it('stamps host coverage and evidence-read timestamps over model-authored values', async () => {
    const create = vi
      .fn<CreateReportProxy['create']>()
      .mockResolvedValue({ content: [], reportId: 'project-report-1' });
    const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
    const run = makeProjectReportRun();
    const args = makeProjectReportArgs();
    args.payload.coverage.matchingActivityCount = 999;
    args.payload.coverage.pagesRead = 999;
    args.payload.provenance.evidenceReadCompletedAt = '2030-01-01T00:00:00.000Z';

    await tool.execute({ runId: run.session.agentic_session_id, run, args });

    expect(sentPayload(create)).toMatchObject({
      coverage: {
        status: 'COMPLETE',
        matchingActivityCount: 4,
        processedActivityCount: 4,
        pagesRead: 1,
        limitations: [],
      },
      provenance: {
        requestId: PROJECT_REPORT_REQUEST_ID,
        attemptId: PROJECT_REPORT_ATTEMPT_ID,
        evidenceReadStartedAt: PREPARED_STARTED_AT,
        evidenceReadCompletedAt: PREPARED_COMPLETED_AT,
      },
    });
    await expect(
      tool.execute({ runId: run.session.agentic_session_id, run, args }),
    ).rejects.toThrow(/one create_report submission/);
  });

  it('preserves exact citation keys and typed evidence through canonical submission', async () => {
    const create = vi.fn<CreateReportProxy['create']>()
      .mockResolvedValue({ content: [], reportId: 'project-report-1' });
    const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
    const run = makeProjectReportRun();
    const reference: ProjectReportEvidenceReference = {
      key: 'selected-period-1',
      subject: { entityType: 'TASK', entityId: PROJECT_REPORT_REQUEST_ID },
      title: 'Deliver invoices', kind: 'SELECTED_PERIOD',
    };
    const original = makeProjectReportArgs();
    const body = { html: `<span data-evidence-key="${reference.key}">Delivered</span>`, css: '' };
    const args = { ...original, payload: {
      ...original.payload, body,
      provenance: { ...original.payload.provenance, evidence: [reference] },
    } };
    await tool.execute({ runId: run.session.agentic_session_id, run, args });
    expect(sentPayload(create)).toMatchObject({ body, provenance: { evidence: [reference] } });
  });

  it('lets the model lower coverage with an added limitation', async () => {
    const create = vi
      .fn<CreateReportProxy['create']>()
      .mockResolvedValue({ content: [], reportId: 'project-report-1' });
    const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
    const run = makeProjectReportRun();
    const args = makeProjectReportArgs();
    args.payload.coverage = {
      status: 'INCOMPLETE',
      matchingActivityCount: 4,
      processedActivityCount: 3,
      pagesRead: 1,
      limitations: ['One action could not be synthesized.'],
    };

    await tool.execute({ runId: run.session.agentic_session_id, run, args });

    expect(sentPayload(create)['coverage']).toEqual({
      status: 'INCOMPLETE',
      matchingActivityCount: 4,
      processedActivityCount: 3,
      pagesRead: 1,
      limitations: ['One action could not be synthesized.'],
    });
  });

  it.each<{
    name: string;
    prepared: Partial<ProjectReportCoverage>;
    submitted: Partial<ProjectReportCoverage>;
    error: RegExp;
  }>([
    {
      name: 'raises INCOMPLETE to COMPLETE',
      prepared: { status: 'INCOMPLETE', limitations: ['Paging stopped early.'] },
      submitted: { status: 'COMPLETE', limitations: ['Paging stopped early.'] },
      error: /status must remain INCOMPLETE/,
    },
    {
      name: 'raises processedActivityCount',
      prepared: {},
      submitted: { processedActivityCount: 5 },
      error: /processedActivityCount must not exceed the prepared 4/,
    },
    {
      name: 'drops a prepared limitation',
      prepared: { status: 'INCOMPLETE', limitations: ['Paging stopped early.'] },
      submitted: { status: 'INCOMPLETE', limitations: [] },
      error: /keep every prepared limitation/,
    },
    {
      name: 'lowers the count while claiming COMPLETE',
      prepared: {},
      submitted: { processedActivityCount: 2, limitations: ['Two actions skipped.'] },
      error: /status must be INCOMPLETE when processedActivityCount is lowered/,
    },
    {
      name: 'lowers coverage without explaining why',
      prepared: {},
      submitted: { status: 'INCOMPLETE' },
      error: /requires an added limitation/,
    },
  ])(
    'rejects project report coverage that $name without claiming the attempt',
    async ({ prepared, submitted, error }) => {
      const create = vi.fn().mockResolvedValue({ content: [], reportId: 'project-report-1' });
      const tool = new CreateReportTool({ create } as unknown as CreateReportProxy);
      const run = makeProjectReportRun({
        status: 'COMPLETE',
        matchingActivityCount: 4,
        processedActivityCount: 4,
        pagesRead: 1,
        limitations: [],
        ...prepared,
      });
      const args = makeProjectReportArgs();
      const valid = { ...args.payload.coverage, ...prepared };
      args.payload.coverage = { ...args.payload.coverage, ...submitted };

      await expect(
        tool.execute({ runId: run.session.agentic_session_id, run, args }),
      ).rejects.toThrow(error);
      expect(create).not.toHaveBeenCalled();

      args.payload.coverage = valid;
      await tool.execute({ runId: run.session.agentic_session_id, run, args });
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { name: 'HTTP 400', fetchImpl: () => makeFetch(new Response('invalid', { status: 400 })) },
    { name: 'HTTP 503', fetchImpl: () => makeFetch(new Response('down', { status: 503 })) },
    {
      name: 'a connection failure',
      fetchImpl: () =>
        vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch,
    },
  ])('releases the project report claim after $name so the model can resubmit', async (entry) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(entry.fetchImpl())
      .mockResolvedValue(restResult('project-report-1'));
    const tool = new CreateReportTool(
      new CreateReportProxy({
        fetchImpl,
        auth: makeSubmissionToolAuth('token-with-org:org-1'),
        apiBaseUrl: 'http://localhost:3000/api/v1',
        reportEmissionEvents: makeReportEmissionEvents(),
      }),
    );
    const run = makeProjectReportRun();
    const context = { runId: run.session.agentic_session_id, run, args: makeProjectReportArgs() };

    await expect(tool.execute(context)).rejects.toThrow();
    await expect(tool.execute(context)).resolves.toBeDefined();
    expect(run.appendReportChainEntry).toHaveBeenCalledOnce();
    await expect(tool.execute(context)).rejects.toThrow(/one create_report submission/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the project report claim when the platform accepted the write but the response was unreadable', async () => {
    const fetchImpl = makeFetch(new Response('not json', { status: 201 }));
    const tool = new CreateReportTool(
      new CreateReportProxy({
        fetchImpl,
        auth: makeSubmissionToolAuth('token-with-org:org-1'),
        apiBaseUrl: 'http://localhost:3000/api/v1',
        reportEmissionEvents: makeReportEmissionEvents(),
      }),
    );
    const run = makeProjectReportRun();
    const context = { runId: run.session.agentic_session_id, run, args: makeProjectReportArgs() };

    await expect(tool.execute(context)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(tool.execute(context)).rejects.toThrow(/one create_report submission/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('recovers a lost response as success and retains the single-write claim', async () => {
    const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(
        jsonResponse(
          {
            success: false,
            message: 'Project report attempt already completed',
            timestamp: '2026-10-03T06:00:00Z',
            statusCode: 409,
            code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
            data: {
              code: 'PROJECT_REPORT_ATTEMPT_COMPLETED',
              requestId: PROJECT_REPORT_REQUEST_ID,
              attemptId: PROJECT_REPORT_ATTEMPT_ID,
              reportId,
            },
          },
          409,
        ),
      );
    const tool = new CreateReportTool(
      new CreateReportProxy({
        fetchImpl,
        auth: makeSubmissionToolAuth('token-with-org:org-1'),
        apiBaseUrl: 'http://localhost:3000/api/v1',
        reportEmissionEvents: makeReportEmissionEvents(),
      }),
    );
    const run = makeProjectReportRun();
    const context = { runId: run.session.agentic_session_id, run, args: makeProjectReportArgs() };
    await expect(tool.execute(context)).rejects.toThrow('fetch failed');
    await expect(tool.execute(context)).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining(reportId) }],
    });
    expect(run.appendReportChainEntry).toHaveBeenCalledOnce();
    await expect(tool.execute(context)).rejects.toThrow(/one create_report submission/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps report emission neutral when legacy response guidance is present', async () => {
    const fetchImpl = makeFetch(
      restResult('report-legacy', {
        guidance: { actions: ['review'], monitorEvaluation: 'skip' },
      }),
    );
    const onReportEmitted = vi.fn();
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(onReportEmitted),
    });

    const result = await proxy.create({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      args: {},
    });

    expect(result.reportId).toBe('report-legacy');
    expect(onReportEmitted).toHaveBeenCalledWith({
      runId: 'run-1',
      reportId: 'report-legacy',
    });
  });

  it('surfaces CreateReportProxyError as the error type', async () => {
    const fetchImpl = makeFetch(new Response('not json', { status: 201 }));
    const proxy = new CreateReportProxy({
      fetchImpl,
      auth: makeSubmissionToolAuth('token-with-org:org-1'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      reportEmissionEvents: makeReportEmissionEvents(),
    });

    await expect(
      proxy.create({ runId: 'r', conversationId: 'conv-1', projectId: 'proj-1', args: {} }),
    ).rejects.toBeInstanceOf(CreateReportProxyError);
  });
});
