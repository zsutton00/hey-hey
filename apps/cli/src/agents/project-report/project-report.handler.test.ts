import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import {
  AgentSessionConfigProjectReportV1TypeEnum,
  AgentSessionConfigProjectReportV1VersionEnum,
  LocalPromptType,
  type RunCreatePayloadProjectReport,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ProjectReportContextPageDtoKindEnum,
  ProjectReportStatus,
  type ProjectReportProvider,
  type ProjectReportRequestDto,
} from '../../shared/api/generated/api';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../prompt-type-handler.test-support';
import type { RegisteredChildLaunchRequest } from '../../run/child-agent-launcher';
import type { SubAgentResult } from '../../run/subagent';
import { projectReportHandler } from './project-report.handler';
import {
  projectReportSectionHandler,
  type ProjectReportSectionPayload,
} from './project-report-section.handler';
import { parseProjectReportPreparedEvidence } from './project-report-submission';

const ORGANIZATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RUN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUBJECT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EXCLUDED_SUBJECT_ID = '11111111-2222-4222-8222-111111111111';
const VIEWED_SUBJECT_ID = '44444444-5555-4555-8555-444444444444';
const FEATURE = { id: '66666666-7777-4777-8777-666666666666', title: 'Project Reports' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEST_TOKEN =
  'header.' +
  Buffer.from(JSON.stringify({ orgId: ORGANIZATION_ID })).toString('base64url') +
  '.signature';

const payload: RunCreatePayloadProjectReport = {
  promptType: LocalPromptType.ProjectReport,
  request: { requestId: REQUEST_ID, attemptId: ATTEMPT_ID, projectId: PROJECT_ID },
};

const makeRequest = (
  withPreset = true,
  provider: ProjectReportProvider = 'codex',
): ProjectReportRequestDto => ({
  id: REQUEST_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  userId: '22222222-3333-4333-8333-222222222222',
  kind: 'PROJECT_REPORT',
  submission: {
    question: 'Which work moved forward and what remains at risk?',
    ...(withPreset
      ? {
          preset: {
            key: 'weekly-review',
            prompt: 'Emphasize notable progress and open risks.',
            outline: 'Progress, risks, next steps',
          },
        }
      : {}),
    scope: {
      projectId: PROJECT_ID,
      windowStart: '2026-09-01T00:00:00.000Z',
      windowEnd: '2026-09-08T00:00:00.000Z',
      timeZone: 'America/Los_Angeles',
    },
    exclusions: [{ entityType: EntityType.Task, entityId: EXCLUDED_SUBJECT_ID }],
    launch: {
      machineId: 'machine-current',
      provider,
      model: 'gpt-5.6-sol',
      effort: 'high',
      fastMode: true,
    },
    idempotencyKey: 'request-idempotency-key',
  },
  status: ProjectReportStatus.Running,
  attempts: [
    {
      id: ATTEMPT_ID,
      attemptNumber: 1,
      status: ProjectReportStatus.Running,
      idempotencyKey: 'attempt-idempotency-key',
      agentSessionId: RUN_ID,
      createdAt: '2026-09-08T00:00:00.000Z',
      startedAt: '2026-09-08T00:00:01.000Z',
    },
  ],
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:01.000Z',
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: RUN_ID,
    entity: null,
    services: [],
    provider: 'codex',
    provider_session_id: 'pending-project-report',
    provider_conversation_id: null,
    status: 'idle',
    conversationId: '33333333-4444-4444-8444-333333333333',
    promptType: LocalPromptType.ProjectReport,
    config: {
      type: AgentSessionConfigProjectReportV1TypeEnum.ProjectReport,
      version: AgentSessionConfigProjectReportV1VersionEnum.V1,
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      model: 'gpt-5.6-sol',
      effort: 'high',
      fastMode: true,
    },
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    fastMode: true,
    contextMetadata: {
      capturedAt: '2026-09-08T00:00:00.000Z',
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      agentSessionId: RUN_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    events: [],
    ...overrides,
  }) as AgenticSession;

const activityRecord = (timestamp: string) => ({
  entityType: EntityType.Task,
  entityId: SUBJECT_ID,
  title: 'Improve report evidence',
  type: ActivityCorrelationActivityType.Unblocked,
  timestamp,
  source: ActivityCorrelationSource.TaskRelationship,
});

const activityPage = (records: ReturnType<typeof activityRecord>[], nextOffset?: number) => ({
  requestId: REQUEST_ID,
  attemptId: ATTEMPT_ID,
  records,
  total: 2,
  ...(nextOffset !== undefined ? { nextOffset } : {}),
  queriedAt: '2026-09-08T00:01:00.000Z',
});

const contextPage = (entityId = SUBJECT_ID) => ({
  requestId: REQUEST_ID,
  attemptId: ATTEMPT_ID,
  subject: { entityType: EntityType.Task, entityId },
  kind: ProjectReportContextPageDtoKindEnum.CurrentStateContext,
  title: 'Improve report evidence',
  status: 'ACTIVE',
  updatedAt: '2026-09-08T00:01:00.000Z',
  relatedSubjects: [{ entityType: EntityType.Task, entityId: EXCLUDED_SUBJECT_ID }],
  queriedAt: '2026-09-08T00:01:00.000Z',
});

/** Serializes a DTO inside the API's standard response envelope. */
const apiResponseBody = (data: unknown) =>
  JSON.stringify({
    success: true,
    message: 'Request processed successfully',
    data,
    timestamp: '2026-09-08T00:00:00.000Z',
    statusCode: 200,
  });

type Placement = {
  plan?: { id: string; title: string };
  features: { id: string; title: string }[];
};

const makeFetch = (
  options: {
    pageFailureOffset?: number;
    contextFailure?: boolean;
    contextFailureOffset?: number;
    withPreset?: boolean;
    provider?: ProjectReportProvider;
    placementFor?: (entityId: string) => Placement;
  } = {},
) => {
  let contextBatchOffset = 0;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/project-report-requests/' + REQUEST_ID + '/activity')) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get('offset'));
        if (options.pageFailureOffset === offset) {
          return new Response('unavailable', { status: 503 });
        }
        return new Response(
          apiResponseBody(
            offset === 0
              ? activityPage([activityRecord('2026-09-03T12:00:00.000Z')], 1)
              : activityPage([activityRecord('2026-09-04T12:00:00.000Z')]),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/project-report-requests/' + REQUEST_ID + '/context:batch')) {
        if (options.contextFailure) return new Response('unavailable', { status: 503 });
        const body = JSON.parse(String(init?.body)) as {
          attemptId: string;
          subjects: { entityType: EntityType; entityId: string }[];
        };
        const offset = contextBatchOffset;
        contextBatchOffset += body.subjects.length;
        if (options.contextFailureOffset === offset) {
          return new Response('bad request', { status: 400 });
        }
        return new Response(
          apiResponseBody({
            requestId: REQUEST_ID,
            attemptId: body.attemptId,
            items: body.subjects.map(({ entityId }) => ({
              context: contextPage(entityId),
              placement: options.placementFor?.(entityId) ?? { features: [FEATURE] },
            })),
            queriedAt: '2026-09-08T00:01:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/project-report-requests/' + REQUEST_ID)) {
        return new Response(apiResponseBody(makeRequest(options.withPreset, options.provider)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Unexpected project report URL: ' + url);
    },
  ) as typeof fetch;

  return { fetchImpl, calls };
};

const sectionHtml = (payload: ProjectReportSectionPayload) =>
  `<section><h2>${payload.group.title}</h2><p><span data-evidence-key="${payload.evidenceReferences[0]!.key}">Moved forward</span> <span data-evidence-key="invented-key">x</span></p></section>`;

const makeDeps = (
  fetchImpl: typeof fetch,
  launch: (
    payload: ProjectReportSectionPayload,
    request: RegisteredChildLaunchRequest,
  ) => Promise<SubAgentResult> = async (payload) => ({
    assistantCompleted: true,
    usage: {},
    outputText: `Here is the section.\n${sectionHtml(payload)}`,
  }),
) => {
  const launchRegistered = vi.fn(
    async (_handlerId: string, request: RegisteredChildLaunchRequest) =>
      launch(request.payload as ProjectReportSectionPayload, request),
  );
  const deps = createPromptTypeHandlerTestDeps({
    auth: createPromptTypeHandlerTestAuth(TEST_TOKEN),
    fetchImpl,
    apiBaseUrl: 'https://api.example.test/api/v1',
    childAgentLauncher: { launchRegistered, resolveChildHandler: () => undefined },
  });
  return Object.assign(deps, { launchRegistered });
};

/** An activity page with one change on each of `count` distinct subjects. */
const manySubjectsFetch = (
  count: number,
  options: Parameters<typeof makeFetch>[0] = {},
): typeof fetch => {
  const base = makeFetch(options);
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/project-report-requests/' + REQUEST_ID + '/activity')) {
      return base.fetchImpl(input, init);
    }
    const offset = Number(new URL(url).searchParams.get('offset'));
    const records = Array.from({ length: Math.min(50, count - offset) }, (_, index) => ({
      ...activityRecord('2026-09-03T12:00:00.000Z'),
      entityId: uuid(offset + index + 1),
      title: `Subject ${offset + index + 1}`,
    }));
    const nextOffset = offset + records.length;
    return new Response(
      apiResponseBody({
        requestId: REQUEST_ID,
        attemptId: ATTEMPT_ID,
        records,
        total: count,
        ...(nextOffset < count ? { nextOffset } : {}),
        queriedAt: '2026-09-08T00:01:00.000Z',
      }),
      { status: 200 },
    );
  }) as typeof fetch;
};

describe('projectReportHandler', () => {
  it('runs fresh with no repository, built-in, or platform graph tools and requires a visible Project Report', () => {
    expect(projectReportHandler).toMatchObject({
      id: 'project_report',
      promptType: LocalPromptType.ProjectReport,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      readOnlyFilesystem: true,
      builtinTools: [],
      mcpToolUseCase: 'project_report',
      reports: [{ reportType: 'PROJECT_REPORT', audience: 'PROJECT_VISIBLE', required: true }],
    });
  });

  it('reads the request and every authorized activity page, then supplies separate current-state context', async () => {
    const { fetchImpl, calls } = makeFetch();
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );

    expect(calls).toHaveLength(4);
    expect(calls.map(({ url }) => url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/project-report-requests/' + REQUEST_ID),
        expect.stringContaining('attemptId=' + ATTEMPT_ID + '&limit=50&offset=0'),
        expect.stringContaining('attemptId=' + ATTEMPT_ID + '&limit=50&offset=1'),
        expect.stringContaining('/project-report-requests/' + REQUEST_ID + '/context:batch'),
      ]),
    );
    const batchCall = calls.find(({ url }) => url.endsWith('/context:batch'))!;
    expect(batchCall.init?.method).toBe('POST');
    expect(JSON.parse(String(batchCall.init?.body))).toEqual({
      attemptId: ATTEMPT_ID,
      subjects: [{ entityType: 'TASK', entityId: SUBJECT_ID }],
    });
    for (const { init } of calls) {
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer ' + TEST_TOKEN,
        Accept: 'application/json',
        'X-Organization-ID': ORGANIZATION_ID,
        'X-Project-ID': PROJECT_ID,
        'X-Agent-Session-ID': RUN_ID,
      });
    }
    expect(payload).toEqual({
      promptType: LocalPromptType.ProjectReport,
      request: { requestId: REQUEST_ID, attemptId: ATTEMPT_ID, projectId: PROJECT_ID },
    });
    expect(prepared.payload).toMatchObject({
      request: { requestId: REQUEST_ID, attemptId: ATTEMPT_ID, projectId: PROJECT_ID },
      _projectReport: {
        request: {
          submission: {
            question: 'Which work moved forward and what remains at risk?',
            preset: { key: 'weekly-review' },
            exclusions: [{ entityType: 'TASK', entityId: EXCLUDED_SUBJECT_ID }],
          },
        },
        evidence: {
          subjects: [
            {
              subject: { entityType: 'TASK', entityId: SUBJECT_ID },
              title: 'Improve report evidence',
              currentStatus: 'ACTIVE',
              activity: [
                {
                  activityType: ActivityCorrelationActivityType.Unblocked,
                  source: ActivityCorrelationSource.TaskRelationship,
                  count: 2,
                  firstOccurredAt: '2026-09-03T12:00:00.000Z',
                  lastOccurredAt: '2026-09-04T12:00:00.000Z',
                },
              ],
              latestActivityEvidenceKey: 'selected-period-1',
              currentStateEvidenceKey: `current-state-TASK-${SUBJECT_ID}`,
              placement: { features: [FEATURE] },
            },
          ],
          evidenceReferences: [
            {
              key: 'selected-period-1',
              kind: 'SELECTED_PERIOD',
              occurredAt: '2026-09-04T12:00:00.000Z',
            },
            { key: `current-state-TASK-${SUBJECT_ID}`, kind: 'CURRENT_STATE_CONTEXT' },
          ],
          coverage: {
            status: 'COMPLETE',
            matchingActivityCount: 2,
            processedActivityCount: 2,
            pagesRead: 2,
            limitations: [],
          },
        },
        sections: [
          {
            title: 'Project Reports',
            subjectCount: 1,
            citedEvidenceKeys: ['selected-period-1'],
          },
        ],
        mentions: [],
      },
    });
    expect(
      prepared.payload._projectReport?.sections[0]?.html.startsWith('<section><h2>Project Reports'),
    ).toBe(true);
  });

  it('builds a stable question-shaped prompt with optional preset guidance and typed isolated submission', async () => {
    const { fetchImpl } = makeFetch();
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );
    const prompt = projectReportHandler.buildPrompt(prepared.payload);

    expect(
      prompt.replace(
        /The evidence read completed at .*?; it started at .*?\. The authoritative prepared coverage metadata is:/u,
        'The evidence read completed at <completed>; it started at <started>. The authoritative prepared coverage metadata is:',
      ),
    ).toMatchSnapshot('question-shaped project report prompt');
    expect(prompt).toContain('Which work moved forward and what remains at risk?');
    expect(prompt).toContain('The optional preset is an outline suggestion for this same report.');
    expect(prompt).toContain('weekly-review');
    expect(prompt).toContain('CURRENT_STATE_CONTEXT');
    expect(prompt).toContain('SELECTED_PERIOD');
    expect(prompt).toContain('selected-period-1');
    expect(prompt).toContain('get_report_schema');
    expect(prompt).toContain(EXCLUDED_SUBJECT_ID);
    expect(prompt).toContain('Call the local create_report tool exactly once');
    expect(prompt).toContain('static HTML and CSS only');
    // Class vocabulary styled by UI Common's report host theme (htmlCssReportTheme.ts).
    for (const className of [
      'summary',
      'interpretation',
      'limitation',
      'timeline',
      'bars',
      'bar',
      'bar-label',
      'bar-value',
      'num',
      'muted',
    ]) {
      expect(prompt).toContain(`class="${className}"`);
    }
    expect(prompt).not.toContain('class="stats"');
    expect(prompt).toContain('## Sections by work group');
    expect(prompt).toContain('<section><h2>Project Reports</h2>');
    expect(prompt).toContain('None. Every group has a section.');
    expect(prompt).toContain('list_reports_by_entity');
    expect(prompt).toContain('Graph reads inform your prose but never add evidence references');
    expect(prompt).toContain('Visual summaries are optional');
    expect(prompt).toContain('Write about the project, not about the report.');
    expect(prompt).toContain('never add left accent borders');
    expect(prompt).toContain('PROJECT_REPORT');
    expect(prompt).toContain('gpt-5.6-sol');
    expect(prompt).not.toContain('filesystem tools');
  });

  it('digests every large-population action per subject, changed subjects first, without listing individual records', async () => {
    const baseFetch = makeFetch();
    const matchingActivityCount = 180;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/project-report-requests/' + REQUEST_ID + '/activity')) {
        return baseFetch.fetchImpl(input, init);
      }

      const offset = Number(new URL(url).searchParams.get('offset'));
      // Every tenth action is a view of a second subject; the rest unblock the main subject.
      const records = Array.from(
        { length: Math.min(50, matchingActivityCount - offset) },
        (_, index) =>
          (offset + index) % 10 === 0
            ? {
                ...activityRecord('2026-09-05T12:00:00.000Z'),
                entityId: VIEWED_SUBJECT_ID,
                title: 'Viewed only',
                type: ActivityCorrelationActivityType.Viewed,
                source: ActivityCorrelationSource.AttentionEvent,
              }
            : {
                ...activityRecord('2026-09-03T12:00:00.000Z'),
                title: `Large population action ${offset + index + 1}`,
              },
      );
      const nextOffset = offset + records.length;
      return new Response(
        apiResponseBody({
          requestId: REQUEST_ID,
          attemptId: ATTEMPT_ID,
          records,
          total: matchingActivityCount,
          ...(nextOffset < matchingActivityCount ? { nextOffset } : {}),
          queriedAt: '2026-09-08T00:01:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    const deps = makeDeps(fetchImpl);
    const prepared = await projectReportHandler.prepare!(makeSession(), payload, deps);
    const evidence = prepared.payload._projectReport?.evidence;
    const prompt = projectReportHandler.buildPrompt(prepared.payload);
    const sectionPrompt = projectReportSectionHandler.buildPrompt(
      deps.launchRegistered.mock.calls[0]![1].payload as ProjectReportSectionPayload,
    );

    expect(evidence?.subjects.map(({ subject }) => subject.entityId)).toEqual([
      SUBJECT_ID,
      VIEWED_SUBJECT_ID,
    ]);
    expect(evidence?.subjects[0]?.activity).toEqual([
      expect.objectContaining({
        activityType: ActivityCorrelationActivityType.Unblocked,
        count: 162,
      }),
    ]);
    expect(evidence?.subjects[1]?.activity).toEqual([
      expect.objectContaining({ activityType: ActivityCorrelationActivityType.Viewed, count: 18 }),
    ]);
    expect(evidence?.evidenceReferences.map(({ kind }) => kind)).toEqual([
      'SELECTED_PERIOD',
      'SELECTED_PERIOD',
      'CURRENT_STATE_CONTEXT',
      'CURRENT_STATE_CONTEXT',
    ]);
    expect(evidence?.coverage).toMatchObject({
      status: 'COMPLETE',
      matchingActivityCount,
      processedActivityCount: matchingActivityCount,
      pagesRead: 4,
    });
    expect(sectionPrompt).toContain('"count": 162');
    expect(sectionPrompt).not.toContain('Large population action 180');
    expect(prompt).not.toContain('Large population action 180');
  });

  it('allows requests without a preset and makes failed paging explicitly incomplete', async () => {
    const { fetchImpl } = makeFetch({ pageFailureOffset: 1, withPreset: false });
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );
    const prompt = projectReportHandler.buildPrompt(prepared.payload);
    const reportContext = prepared.payload._projectReport;

    expect(reportContext?.request.submission.preset).toBeUndefined();
    expect(reportContext?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      matchingActivityCount: 2,
      processedActivityCount: 1,
      pagesRead: 1,
      limitations: [expect.stringContaining('offset 1')],
    });
    expect(prompt).toContain('coverage.status must remain INCOMPLETE');
    expect(prompt).toContain('the report body must explain the gap');
    expect(prompt).toContain('you may only lower coverage');
    expect(parseProjectReportPreparedEvidence(prepared.sessionContext)).toEqual({
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      evidenceReadStartedAt: reportContext?.evidence.evidenceReadStartedAt,
      evidenceReadCompletedAt: reportContext?.evidence.evidenceReadCompletedAt,
      coverage: reportContext?.evidence.coverage,
    });
  });

  it.each(['activity', 'context'])(
    'recovers from network and 5xx failures reading %s',
    async (kind) => {
      const base = makeFetch();
      let reads = 0;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes(kind === 'activity' ? '/activity?' : '/context:batch')) {
          reads += 1;
          if (reads === 1) throw new TypeError('network unavailable');
          if (reads === 2) return new Response('unavailable', { status: 503 });
        }
        return base.fetchImpl(input, init);
      });
      const prepared = await projectReportHandler.prepare!(
        makeSession(),
        payload,
        makeDeps(fetchImpl),
      );
      expect(prepared.payload._projectReport?.evidence.coverage.status).toBe('COMPLETE');
      expect(reads).toBe(kind === 'activity' ? 4 : 3);
    },
  );

  it.each([400, 403, 503])('bounds failed evidence reads for HTTP %s', async (status) => {
    const base = makeFetch();
    let reads = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/activity?')) {
        reads += 1;
        return new Response('unavailable', { status });
      }
      return base.fetchImpl(input, init);
    });
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );
    expect(reads).toBe(status === 503 ? 3 : 1);
    expect(prepared.payload._projectReport?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      limitations: expect.arrayContaining([expect.stringContaining(`HTTP ${status}`)]),
    });
  });

  it('marks current-state context failures incomplete without counting them as selected-period actions', async () => {
    const { fetchImpl } = makeFetch({ contextFailure: true });
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );

    expect(prepared.payload._projectReport?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      matchingActivityCount: 2,
      processedActivityCount: 2,
      pagesRead: 2,
      limitations: [
        'Current-state detail for 1 of 1 included subjects could not be read (HTTP 503); coverage is incomplete.',
      ],
    });
  });

  it('reads current-state detail for more than 100 subjects in batches with no subject-detail bound', async () => {
    const calls: string[] = [];
    const base = manySubjectsFetch(150);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      return base(input, init);
    }) as typeof fetch;
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(fetchImpl),
    );
    const evidence = prepared.payload._projectReport!.evidence;

    expect(calls.filter((url) => url.endsWith('/context:batch'))).toHaveLength(2);
    expect(evidence.subjects).toHaveLength(150);
    expect(evidence.subjects.every((subject) => subject.currentStateEvidenceKey)).toBe(true);
    expect(evidence.coverage).toMatchObject({
      status: 'COMPLETE',
      processedActivityCount: 150,
      limitations: [],
    });
    expect(JSON.stringify(evidence.coverage)).not.toMatch(/bounded|most active/u);
  });

  it('keeps the other batches when one current-state batch fails', async () => {
    const prepared = await projectReportHandler.prepare!(
      makeSession(),
      payload,
      makeDeps(manySubjectsFetch(150, { contextFailureOffset: 100 })),
    );
    const evidence = prepared.payload._projectReport!.evidence;

    expect(evidence.subjects.filter((subject) => subject.currentStateEvidenceKey)).toHaveLength(
      100,
    );
    expect(evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      limitations: [
        'Current-state detail for 50 of 150 included subjects could not be read (HTTP 400); coverage is incomplete.',
      ],
    });
  });

  it('launches one read-only section child per funded group, on the run model, with its token share', async () => {
    const placementFor = (entityId: string): Placement => ({
      features: [{ id: entityId, title: `Area ${entityId.slice(-3)}` }],
    });
    const deps = makeDeps(manySubjectsFetch(3, { placementFor }));
    const prepared = await projectReportHandler.prepare!(makeSession(), payload, deps);

    expect(deps.launchRegistered).toHaveBeenCalledTimes(3);
    for (const [handlerId, request] of deps.launchRegistered.mock.calls) {
      expect(handlerId).toBe('project_report_section');
      expect(request).toMatchObject({
        serviceIds: [],
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        tokenBudget: expect.any(Number),
      });
      const sectionPayload = request.payload as ProjectReportSectionPayload;
      expect(sectionPayload.subjects).toHaveLength(1);
      expect(sectionPayload.evidenceReferences.map(({ key }) => key)).toEqual([
        sectionPayload.subjects[0]!.latestActivityEvidenceKey,
        sectionPayload.subjects[0]!.currentStateEvidenceKey,
      ]);
    }
    const budgets = deps.launchRegistered.mock.calls.map(([, request]) => request.tokenBudget!);
    expect(budgets.reduce((sum, budget) => sum + budget, 0)).toBeLessThanOrEqual(3_000_000);
    expect(projectReportSectionHandler.childConfig).toMatchObject({
      submissionTools: 'none',
      builtinAllowedTools: [],
      codexSandboxMode: 'read-only',
    });
    expect(projectReportSectionHandler.childConfig!.mcpAllowedTools).not.toContain(
      'get_report_schema',
    );
    expect(projectReportSectionHandler.childConfig!.mcpAllowedTools).not.toContain('create_report');
    expect(prepared.payload._projectReport?.sections).toHaveLength(3);
    expect(prepared.payload._projectReport?.evidence.coverage.status).toBe('COMPLETE');
  });

  it('turns unfunded, exhausted and failed groups into named mentions and incomplete coverage', async () => {
    // Thirteen root product areas cannot climb, so one falls outside twelve sections.
    const placementFor = (entityId: string): Placement => ({
      features: [{ id: entityId, title: `Area ${Number(entityId.slice(-3))}` }],
    });
    const deps = makeDeps(manySubjectsFetch(13, { placementFor }), async (sectionPayload) => {
      if (sectionPayload.group.title === 'Area 1') {
        return {
          assistantCompleted: false,
          usage: {},
          outputText: '<section>half',
          budgetExhausted: true,
        };
      }
      if (sectionPayload.group.title === 'Area 2') throw new Error('provider failed');
      return { assistantCompleted: true, usage: {}, outputText: sectionHtml(sectionPayload) };
    });
    const prepared = await projectReportHandler.prepare!(makeSession(), payload, deps);
    const report = prepared.payload._projectReport!;
    const prompt = projectReportHandler.buildPrompt(prepared.payload);

    expect(deps.launchRegistered).toHaveBeenCalledTimes(12);
    expect(report.sections).toHaveLength(10);
    expect(report.mentions.map(({ title, reason }) => [title, reason])).toEqual([
      ['Area 1', 'BUDGET_EXHAUSTED'],
      ['Area 2', 'FAILED'],
      ['Area 13', 'OUTSIDE_BUDGET'],
    ]);
    expect(report.evidence.coverage.status).toBe('INCOMPLETE');
    expect(report.evidence.coverage.limitations).toEqual([
      'The report token budget could not cover every work group; 1 work group (1 subject) is only mentioned, without a section of their own: Area 13.',
      'Section summaries ran out of their token share; 1 work group (1 subject) is only mentioned, without a section of their own: Area 1.',
      'Section summaries could not be written; 1 work group (1 subject) is only mentioned, without a section of their own: Area 2.',
    ]);
    expect(parseProjectReportPreparedEvidence(prepared.sessionContext).coverage).toEqual(
      report.evidence.coverage,
    );
    expect(prompt).toContain('- Area 13: 1 subject, 1 recorded change');
    expect(prompt).toContain('name every work group without a section');
  });

  it('lists every group as a mention on a provider that cannot run section children', async () => {
    const deps = makeDeps(makeFetch({ provider: 'opencode' }).fetchImpl);
    const prepared = await projectReportHandler.prepare!(
      makeSession({ provider: 'opencode' }),
      payload,
      deps,
    );
    expect(deps.launchRegistered).not.toHaveBeenCalled();
    expect(prepared.payload._projectReport?.mentions).toMatchObject([
      { title: 'Project Reports', reason: 'PROVIDER_UNSUPPORTED' },
    ]);
    expect(prepared.payload._projectReport?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      limitations: [expect.stringContaining('not available for this provider')],
    });
  });

  it('rejects a service-scoped session and rejects a request bound to another active attempt', async () => {
    const { fetchImpl } = makeFetch();
    await expect(
      projectReportHandler.prepare!(
        makeSession({ services: [{ id: 'service', path: '/repo' }] }),
        payload,
        makeDeps(fetchImpl),
      ),
    ).rejects.toThrow(/service-free session boundary/);

    const staleAttemptFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/project-report-requests/' + REQUEST_ID)) {
        const staleRequest = makeRequest();
        staleRequest.attempts[0]!.id = '99999999-9999-4999-8999-999999999999';
        return new Response(apiResponseBody(staleRequest), { status: 200 });
      }
      return fetchImpl(input, init);
    }) as typeof fetch;
    await expect(
      projectReportHandler.prepare!(makeSession(), payload, makeDeps(staleAttemptFetch)),
    ).rejects.toThrow(/did not match the signed AgentSession/);
  });

  it('rejects an excluded subject returned as primary activity evidence', async () => {
    const { fetchImpl } = makeFetch();
    const maliciousFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/project-report-requests/' + REQUEST_ID + '/activity')) {
        return new Response(
          apiResponseBody({
            ...activityPage([
              { ...activityRecord('2026-09-03T12:00:00.000Z'), entityId: EXCLUDED_SUBJECT_ID },
            ]),
            total: 1,
          }),
          { status: 200 },
        );
      }
      return fetchImpl(input, init);
    }) as typeof fetch;
    await expect(
      projectReportHandler.prepare!(makeSession(), payload, makeDeps(maliciousFetch)),
    ).rejects.toThrow(/excluded entity as a primary subject/);
  });
});
