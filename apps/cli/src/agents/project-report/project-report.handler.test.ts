import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import {
  AgentSessionConfigProjectReportV1TypeEnum,
  AgentSessionConfigProjectReportV1VersionEnum,
  LocalPromptType,
  type RunCreatePayloadProjectReport,
} from '@hey-hey/contracts/agent-bridge';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ProjectReportContextPageDtoKindEnum,
  ProjectReportStatus,
  type ProjectReportProvider,
  type ProjectReportRequestDto,
} from '@hey-hey/contracts/api/models';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../prompt-type-handler.test-support';
import type { RegisteredChildLaunchRequest } from '../../run/child-agent-launcher';
import type { Run } from '../../run/run';
import type { SubAgentResult } from '../../run/subagent';
import { MAX_PROMPT_BYTES } from '../../run-store/durable-events';
import { NOOP_LOGGER } from '../../server/logger';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { CreateReportTool } from '../submission-tools/create-report-tool';
import { ReadEvidenceShardTool } from '../submission-tools/read-evidence-shard-tool';
import { SubmissionToolCorrectableError } from '../submission-tools/types';
import { projectReportHandler } from './project-report.handler';
import {
  projectReportEvidenceLedgers,
  type ProjectReportEvidenceLedger,
} from './project-report-evidence-store';
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
    newestFirst?: boolean;
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
        const [first, second] = options.newestFirst
          ? ['2026-09-04T12:00:00.000Z', '2026-09-03T12:00:00.000Z']
          : ['2026-09-03T12:00:00.000Z', '2026-09-04T12:00:00.000Z'];
        return new Response(
          apiResponseBody(
            offset === 0
              ? activityPage([activityRecord(first!)], 1)
              : activityPage([activityRecord(second!)]),
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

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const ledgerOf = (): ProjectReportEvidenceLedger => {
  const ledger = projectReportEvidenceLedgers.get(RUN_ID);
  if (!ledger) throw new Error('Expected prepare to register an evidence ledger');
  return ledger;
};

/** What a section child does through read_evidence_shard: read every page it is assigned. */
const readAssignedPages = async (payload: ProjectReportSectionPayload): Promise<void> => {
  for (const shard of payload.shards) {
    for (const page of shard.pagesToRead) {
      await ledgerOf().readPage(shard.id, page);
    }
  }
};

const readingChild = async (payload: ProjectReportSectionPayload): Promise<SubAgentResult> => {
  await readAssignedPages(payload);
  return {
    assistantCompleted: true,
    usage: {},
    outputText: `- ${payload.group.title}: moved forward (selected-period-1)`,
  };
};

const makeDeps = (
  fetchImpl: typeof fetch,
  launch: (
    payload: ProjectReportSectionPayload,
    request: RegisteredChildLaunchRequest,
  ) => Promise<SubAgentResult> = readingChild,
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

const prepare = async (
  session: AgenticSession,
  deps: ReturnType<typeof makeDeps>,
): ReturnType<NonNullable<typeof projectReportHandler.prepare>> => {
  const runEvidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-report-test-'));
  tempDirectories.push(runEvidenceDirectory);
  return projectReportHandler.prepare!(session, payload, deps, {
    runId: RUN_ID,
    logger: NOOP_LOGGER,
    recentUserReplies: [],
    triggerParentMessageId: null,
    runEvidenceDirectory,
  });
};

/** Every line of every shard, in manifest order, through the same reads an agent makes. */
const readAllShardLines = async (): Promise<Array<Record<string, unknown>>> => {
  const ledger = ledgerOf();
  const lines: Array<Record<string, unknown>> = [];
  for (const shard of ledger.manifest.shards) {
    for (let page = 1; page <= shard.pageCount; page += 1) {
      const result = await ledger.readPage(shard.id, page);
      lines.push(
        ...result.text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>),
      );
    }
  }
  return lines;
};

/** `subjects` subjects with `perSubject` activities each, newest records first as the API orders them. */
const denseFetch = (
  subjects: number,
  perSubject: number,
  options: Parameters<typeof makeFetch>[0] = {},
): typeof fetch => {
  const base = makeFetch(options);
  const total = subjects * perSubject;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/project-report-requests/' + REQUEST_ID + '/activity')) {
      return base.fetchImpl(input, init);
    }
    const offset = Number(new URL(url).searchParams.get('offset'));
    const records = Array.from({ length: Math.min(50, total - offset) }, (_, index) => {
      const position = offset + index;
      const day = String(1 + (position % 7)).padStart(2, '0');
      return {
        ...activityRecord(`2026-09-${day}T12:00:00.000Z`),
        entityId: uuid((position % subjects) + 1),
        title: `Subject ${(position % subjects) + 1} change ${position}`,
      };
    });
    const nextOffset = offset + records.length;
    return new Response(
      apiResponseBody({
        requestId: REQUEST_ID,
        attemptId: ATTEMPT_ID,
        records,
        total,
        ...(nextOffset < total ? { nextOffset } : {}),
        queriedAt: '2026-09-08T00:01:00.000Z',
      }),
      { status: 200 },
    );
  }) as typeof fetch;
};

const submissionArgs = (coverage: Record<string, unknown>) => ({
  reportType: 'PROJECT_REPORT',
  audience: 'PROJECT_VISIBLE',
  payload: {
    reportType: 'PROJECT_REPORT',
    title: 'Project activity',
    summary: 'A short evidence-backed summary.',
    question: 'Which work moved forward and what remains at risk?',
    scope: {
      projectId: PROJECT_ID,
      windowStart: '2026-09-01T00:00:00.000Z',
      windowEnd: '2026-09-08T00:00:00.000Z',
      timeZone: 'America/Los_Angeles',
    },
    exclusions: [],
    provenance: {
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      evidenceReadStartedAt: '2026-09-08T00:00:00.000Z',
      evidenceReadCompletedAt: '2026-09-08T00:01:00.000Z',
      evidence: [],
    },
    coverage,
    body: { html: '<main>Report</main>', css: '' },
  },
});

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
  it('runs fresh with no built-in tools, reads evidence only through the host tool, and requires a visible Project Report', () => {
    expect(projectReportHandler).toMatchObject({
      id: 'project_report',
      promptType: LocalPromptType.ProjectReport,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      readOnlyFilesystem: true,
      builtinTools: [],
      runEvidenceDirectory: true,
      mcpToolUseCase: 'project_report',
      reports: [{ reportType: 'PROJECT_REPORT', audience: 'PROJECT_VISIBLE', required: true }],
    });
    expect(projectReportHandler.submissionTools?.map(({ name }) => name)).toEqual([
      'read_evidence_shard',
    ]);
  });

  it('reads the request and every authorized activity page, then writes current-state context and activity to shards', async () => {
    const { fetchImpl, calls } = makeFetch({ newestFirst: true });
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));

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

    const report = prepared.payload._projectReport!;
    expect(report.request.submission).toMatchObject({
      question: 'Which work moved forward and what remains at risk?',
      preset: { key: 'weekly-review' },
      exclusions: [{ entityType: 'TASK', entityId: EXCLUDED_SUBJECT_ID }],
    });
    expect(report.evidence.coverage).toEqual({
      status: 'COMPLETE',
      matchingActivityCount: 2,
      processedActivityCount: 2,
      pagesRead: 2,
      limitations: [],
    });
    expect(report.evidence).not.toHaveProperty('subjects');
    expect(report.evidence.manifest).toMatchObject({
      totalRecordCount: 3,
      totalActivityCount: 2,
      shards: [
        {
          id: 'shard-0001',
          groupTitle: 'Project Reports',
          subjectCount: 1,
          recordCount: 3,
          activityCount: 2,
        },
      ],
    });

    // One subject opens with its current state, then every activity, oldest first.
    const lines = await readAllShardLines();
    expect(lines).toMatchObject([
      {
        kind: 'CURRENT_STATE_CONTEXT',
        subject: { entityType: 'TASK', entityId: SUBJECT_ID },
        currentStatus: 'ACTIVE',
        placement: { features: [FEATURE] },
        evidenceReferences: [
          { key: 'selected-period-1', kind: 'SELECTED_PERIOD' },
          { key: `current-state-TASK-${SUBJECT_ID}`, kind: 'CURRENT_STATE_CONTEXT' },
        ],
      },
      { kind: 'SELECTED_PERIOD', timestamp: '2026-09-03T12:00:00.000Z' },
      { kind: 'SELECTED_PERIOD', timestamp: '2026-09-04T12:00:00.000Z' },
    ]);
    expect(parseProjectReportPreparedEvidence(prepared.sessionContext)).toEqual({
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      evidenceReadStartedAt: report.evidence.evidenceReadStartedAt,
      evidenceReadCompletedAt: report.evidence.evidenceReadCompletedAt,
      coverage: report.evidence.coverage,
    });
  });

  it('builds a stable question-shaped prompt that carries the request, totals and manifest, never the evidence', async () => {
    const { fetchImpl } = makeFetch();
    const prepared = await prepare(
      makeSession(),
      makeDeps(fetchImpl, async (sectionPayload) => {
        await readAssignedPages(sectionPayload);
        return { assistantCompleted: true, usage: {}, outputText: 'Moved forward.' };
      }),
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
    expect(prompt).toContain('read_evidence_shard');
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
    expect(prompt).toContain('list_reports_by_entity');
    expect(prompt).toContain('Visual summaries are optional');
    expect(prompt).toContain('Write about the project, not about the report.');
    expect(prompt).toContain('never add left accent borders');
    expect(prompt).toContain('PROJECT_REPORT');
    expect(prompt).toContain('gpt-5.6-sol');
    expect(prompt).not.toContain('filesystem tools');
    // The evidence itself stays in the shards.
    expect(prompt).not.toContain('Improve report evidence');
    expect(prompt).not.toContain(SUBJECT_ID);
  });

  it('publishes child findings with the evidence references they cite for the editing agent', async () => {
    const { fetchImpl } = makeFetch();
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));

    expect(prepared.payload._projectReport?.findingsPublished).toBe(true);
    const findings = await ledgerOf().readPage('findings', 1);
    expect(findings.text).toContain('Project Reports: moved forward (selected-period-1)');
    expect(findings.text).toContain('Evidence references for the keys cited above');
    expect(findings.text).toContain('"key": "selected-period-1"');
    expect(findings.text).not.toContain(`current-state-TASK-${SUBJECT_ID}`);
  });

  it('keeps every record of a subject together, changed subjects first, without listing them in the prompt', async () => {
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
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));
    const report = prepared.payload._projectReport!;
    const prompt = projectReportHandler.buildPrompt(prepared.payload);

    const lines = await readAllShardLines();
    const contextLines = lines.filter(({ kind }) => kind === 'CURRENT_STATE_CONTEXT');
    expect(contextLines.map(({ subject }) => (subject as { entityId: string }).entityId)).toEqual([
      SUBJECT_ID,
      VIEWED_SUBJECT_ID,
    ]);
    expect(lines.filter(({ kind }) => kind === 'SELECTED_PERIOD')).toHaveLength(180);
    expect(lines.filter(({ title }) => title === 'Viewed only')).toHaveLength(18);
    expect(report.evidence.coverage).toMatchObject({
      status: 'COMPLETE',
      matchingActivityCount,
      processedActivityCount: matchingActivityCount,
      pagesRead: 4,
    });
    expect(prompt).not.toContain('Large population action 180');
  });

  it('allows requests without a preset and makes failed paging explicitly incomplete', async () => {
    const { fetchImpl } = makeFetch({ pageFailureOffset: 1, withPreset: false });
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));
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
    // The manifest only lists records that were actually written.
    expect(reportContext?.evidence.manifest.totalActivityCount).toBe(1);
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
      const prepared = await prepare(makeSession(), makeDeps(fetchImpl));
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
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));
    expect(reads).toBe(status === 503 ? 3 : 1);
    expect(prepared.payload._projectReport?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      limitations: expect.arrayContaining([expect.stringContaining(`HTTP ${status}`)]),
    });
  });

  it('marks current-state context failures incomplete without counting them as selected-period actions', async () => {
    const { fetchImpl } = makeFetch({ contextFailure: true });
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));

    expect(prepared.payload._projectReport?.evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      matchingActivityCount: 2,
      processedActivityCount: 2,
      pagesRead: 2,
      limitations: [
        'Current-state detail for 1 of 1 included subjects could not be read (HTTP 503); coverage is incomplete.',
      ],
    });
    const [context] = await readAllShardLines();
    expect(context).toMatchObject({ currentStateUnavailable: true });
  });

  it('reads current-state detail for more than 100 subjects in batches with no subject-detail bound', async () => {
    const calls: string[] = [];
    const base = manySubjectsFetch(150);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      return base(input, init);
    }) as typeof fetch;
    const prepared = await prepare(makeSession(), makeDeps(fetchImpl));
    const evidence = prepared.payload._projectReport!.evidence;
    const contextLines = (await readAllShardLines()).filter(
      ({ kind }) => kind === 'CURRENT_STATE_CONTEXT',
    );

    expect(calls.filter((url) => url.endsWith('/context:batch'))).toHaveLength(2);
    expect(contextLines).toHaveLength(150);
    expect(contextLines.every((line) => line['currentStateUnavailable'] === undefined)).toBe(true);
    expect(evidence.coverage).toMatchObject({
      status: 'COMPLETE',
      processedActivityCount: 150,
      limitations: [],
    });
    expect(JSON.stringify(evidence.coverage)).not.toMatch(/bounded|most active/u);
  });

  it('keeps the other batches when one current-state batch fails', async () => {
    const prepared = await prepare(
      makeSession(),
      makeDeps(manySubjectsFetch(150, { contextFailureOffset: 100 })),
    );
    const evidence = prepared.payload._projectReport!.evidence;
    const contextLines = (await readAllShardLines()).filter(
      ({ kind }) => kind === 'CURRENT_STATE_CONTEXT',
    );

    expect(contextLines.filter((line) => line['currentStateUnavailable'] === true)).toHaveLength(
      50,
    );
    expect(evidence.coverage).toMatchObject({
      status: 'INCOMPLETE',
      limitations: [
        'Current-state detail for 50 of 150 included subjects could not be read (HTTP 400); coverage is incomplete.',
      ],
    });
  });

  it('launches one section child per work group on the run model, reading only the evidence tool', async () => {
    const placementFor = (entityId: string): Placement => ({
      features: [{ id: entityId, title: `Area ${entityId.slice(-3)}` }],
    });
    const deps = makeDeps(manySubjectsFetch(3, { placementFor }));
    const prepared = await prepare(makeSession(), deps);

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
      expect(sectionPayload.shards).toHaveLength(1);
      expect(sectionPayload.shards[0]!.pagesToRead).toEqual([1]);
      expect(sectionPayload).not.toHaveProperty('subjects');
    }
    expect(projectReportSectionHandler.childConfig).toMatchObject({
      submissionTools: 'run-registered',
      submissionToolNames: ['read_evidence_shard', 'raise_uncertainty'],
      builtinAllowedTools: [],
      codexSandboxMode: 'read-only',
    });
    expect(projectReportSectionHandler.childConfig!.mcpAllowedTools).not.toContain(
      'get_report_schema',
    );
    expect(prepared.payload._projectReport?.parentShardIds).toEqual([]);
    expect(prepared.payload._projectReport?.evidence.coverage.status).toBe('COMPLETE');
    expect(ledgerOf().unreadShards()).toEqual([]);
  });

  it('replaces a child that stops early, then hands a group that keeps stalling to the report agent', async () => {
    const placementFor = (entityId: string): Placement => ({
      features: [{ id: entityId, title: `Area ${Number(entityId.slice(-3))}` }],
    });
    const deps = makeDeps(manySubjectsFetch(3, { placementFor }), async (sectionPayload) => {
      if (sectionPayload.group.title === 'Area 1') {
        // Ends without reading anything, as a child out of token budget would.
        return { assistantCompleted: false, usage: {}, outputText: '', budgetExhausted: true };
      }
      if (sectionPayload.group.title === 'Area 2') throw new Error('provider failed');
      return readingChild(sectionPayload);
    });
    const prepared = await prepare(makeSession(), deps);
    const launchedFor = (title: string) =>
      deps.launchRegistered.mock.calls.filter(
        ([, request]) => (request.payload as ProjectReportSectionPayload).group.title === title,
      ).length;

    // One child, then replacements until two in a row read nothing new.
    expect(launchedFor('Area 1')).toBe(3);
    expect(launchedFor('Area 2')).toBe(3);
    expect(launchedFor('Area 3')).toBe(1);
    const report = prepared.payload._projectReport!;
    const unread = ledgerOf().unreadShards();
    expect(unread.map(({ groupTitle }) => groupTitle).sort()).toEqual(['Area 1', 'Area 2']);
    expect(report.parentShardIds).toEqual(unread.map(({ id }) => id));
    const prompt = projectReportHandler.buildPrompt(prepared.payload);
    expect(prompt).toContain('You must read every page of these 2 shards yourself');
    for (const shard of unread) expect(prompt).toContain(shard.id);
  });

  it('has the report agent read every shard itself on a provider that cannot run section children', async () => {
    const deps = makeDeps(makeFetch({ provider: 'opencode' }).fetchImpl);
    const prepared = await prepare(makeSession({ provider: 'opencode' }), deps);

    expect(deps.launchRegistered).not.toHaveBeenCalled();
    expect(prepared.payload._projectReport?.parentShardIds).toEqual(['shard-0001']);
    expect(prepared.payload._projectReport?.findingsPublished).toBe(false);
    expect(prepared.payload._projectReport?.evidence.coverage.status).toBe('COMPLETE');
  });

  it('starts a report whose evidence exceeds the prompt limit, and the prompt does not grow with the selection', async () => {
    const small = await prepare(makeSession(), makeDeps(denseFetch(300, 10)));
    const smallPrompt = projectReportHandler.buildPrompt(small.payload);

    const deps = makeDeps(denseFetch(600, 10));
    const large = await prepare(makeSession(), deps);
    const largePrompt = projectReportHandler.buildPrompt(large.payload);
    const { manifest, coverage } = large.payload._projectReport!.evidence;

    // 6,000 activities is past the old 5,000-record and 100-page bounds.
    expect(coverage).toMatchObject({
      status: 'COMPLETE',
      matchingActivityCount: 6000,
      processedActivityCount: 6000,
      pagesRead: 120,
      limitations: [],
    });
    expect(manifest.totalActivityCount).toBe(6000);
    expect(manifest.totalRecordCount).toBe(6600);
    expect(manifest.shards.reduce((sum, shard) => sum + shard.recordCount, 0)).toBe(6600);
    expect(manifest.shards.reduce((sum, shard) => sum + shard.subjectCount, 0)).toBe(600);
    expect(manifest.shards.length).toBeGreaterThan(1);
    expect(manifest.shards.every((shard) => shard.byteSize < 200_000)).toBe(true);

    // Inlined, this evidence would have been over the run store's prompt limit.
    expect(manifest.shards.reduce((sum, shard) => sum + shard.byteSize, 0)).toBeGreaterThan(
      MAX_PROMPT_BYTES,
    );
    expect(Buffer.byteLength(largePrompt, 'utf8')).toBeLessThan(MAX_PROMPT_BYTES);
    expect(Math.abs(largePrompt.length - smallPrompt.length)).toBeLessThan(200);
    expect(largePrompt).not.toContain('Subject 600 change');

    // Every record is on disk and was read by a helper through the host.
    expect(await readAllShardLines()).toHaveLength(6600);
    expect(ledgerOf().unreadShards()).toEqual([]);
    expect(deps.launchRegistered).toHaveBeenCalledOnce();
  });

  describe('create_report', () => {
    const coverage = {
      status: 'COMPLETE',
      matchingActivityCount: 2,
      processedActivityCount: 2,
      pagesRead: 2,
      limitations: [] as string[],
    };

    it('is refused, listing the unread shards, until the host has served every page, and a refusal claims nothing', async () => {
      const session = makeSession({ provider: 'opencode' });
      const prepared = await prepare(
        session,
        makeDeps(makeFetch({ provider: 'opencode' }).fetchImpl),
      );
      const run = {
        session: { ...session, sessionContext: prepared.sessionContext },
        projectId: PROJECT_ID,
        conversationId: session.conversationId,
        appendReportChainEntry: vi.fn(),
      } as unknown as Run;
      const create = vi
        .fn<CreateReportProxy['create']>()
        .mockResolvedValue({ content: [], reportId: 'project-report-1' });
      const createReport = new CreateReportTool({ create } as unknown as CreateReportProxy);
      const submit = () =>
        createReport.execute({ runId: RUN_ID, run, args: submissionArgs(coverage) });

      const refusal: unknown = await submit().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(SubmissionToolCorrectableError);
      expect((refusal as SubmissionToolCorrectableError).findings).toMatchObject([
        { identity: 'shard-0001', correction: expect.stringContaining('read_evidence_shard') },
      ]);
      expect(create).not.toHaveBeenCalled();

      // An agent claiming it read the shard changes nothing; only pages the host served count.
      await expect(submit()).rejects.toBeInstanceOf(SubmissionToolCorrectableError);

      const read = await new ReadEvidenceShardTool().execute({
        runId: RUN_ID,
        run,
        args: { shardId: 'shard-0001', page: 1 },
      });
      expect(read.content[0]).toMatchObject({ text: expect.stringContaining('SELECTED_PERIOD') });
      await expect(submit()).resolves.toBeDefined();
      expect(create).toHaveBeenCalledOnce();
    });

    it('stays refused for a multi-page shard until its last page is read', async () => {
      const session = makeSession({ provider: 'opencode' });
      await prepare(session, makeDeps(denseFetch(40, 10, { provider: 'opencode' })));
      const [shard] = ledgerOf().manifest.shards;
      expect(shard!.pageCount).toBeGreaterThan(1);

      for (let page = 1; page < shard!.pageCount; page += 1) {
        await ledgerOf().readPage(shard!.id, page);
      }
      expect(
        ledgerOf()
          .unreadShards()
          .map(({ id }) => id),
      ).toEqual([shard!.id]);
      expect(ledgerOf().unreadPages(shard!)).toEqual([shard!.pageCount]);

      await ledgerOf().readPage(shard!.id, shard!.pageCount);
      expect(ledgerOf().unreadShards()).toEqual([]);
    });
  });

  it('rejects a service-scoped session and rejects a request bound to another active attempt', async () => {
    const { fetchImpl } = makeFetch();
    await expect(
      prepare(makeSession({ services: [{ id: 'service', path: '/repo' }] }), makeDeps(fetchImpl)),
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
    await expect(prepare(makeSession(), makeDeps(staleAttemptFetch))).rejects.toThrow(
      /did not match the signed AgentSession/,
    );
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
    await expect(prepare(makeSession(), makeDeps(maliciousFetch))).rejects.toThrow(
      /excluded entity as a primary subject/,
    );
  });
});
