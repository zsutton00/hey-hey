import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewHandler } from '../review-subagent/review.handler';
import { CreateReportTool } from './create-report-tool';
import { makeCreateReportProxy } from './create-report-proxy.test-support';
import type { Run } from '../../run/run';
import { createTestRun } from '../../run/run.test-support';
import type { ReportChainEntry } from '../../run/types';
import type { Turn } from '../../turn/turn';
import type { SubmissionToolMcpContent } from './types';
import {
  jointDecision,
  overlappingDecisions,
} from '../feature-sync/__tests__/feature-sync-decision.fixtures';
import { CreateReportProxy } from './create-report-proxy';
import { ReportEmissionEvents } from './report-emission-events';
import { SubmissionToolAuth } from './submission-tool-auth';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';

const FIXED_NOW = '2026-06-26T10:00:00.000Z';

interface TestRunOptions {
  promptType?: string;
  providerSessionId?: string;
  activeTurnId?: string | null;
  completedAssistantMessageId?: string | null;
  fileChangeProjection?: ReturnType<Run['getFileChangeProjection']>;
}

const makeRun = (options: TestRunOptions = {}): Run => {
  const run = createTestRun({ conversationId: 'conv-test', projectId: 'proj-test' });
  run.session.promptType = options.promptType ?? 'feature_sync_analyze';
  run.session.provider_session_id = options.providerSessionId ?? 'provider-session-1';
  vi.spyOn(run, 'appendReportChainEntry').mockImplementation(() => undefined);
  vi.spyOn(run, 'observePersistedPlanReady').mockImplementation(() => undefined);
  vi.spyOn(run, 'getFileChangeProjection').mockReturnValue(options.fileChangeProjection ?? []);
  vi.spyOn(run, 'logImplementReportValidation').mockImplementation(() => undefined);
  if (options.activeTurnId !== null) {
    run.setActiveTurn({
      turnId: options.activeTurnId ?? 'turn-authoritative',
      completedAssistantMessageId: options.completedAssistantMessageId ?? null,
    } as Turn);
  }
  return run;
};

const makePlatformContent = (id: string): SubmissionToolMcpContent[] => [
  { type: 'text', text: JSON.stringify({ reportId: id, status: 'created' }) },
];

const makeArgs = (overrides?: Record<string, unknown>): Record<string, unknown> => ({
  reportType: 'FEATURE_SYNC',
  audience: 'PROJECT_VISIBLE',
  payload: { summary: 'feature drift detected in auth flow', reportType: 'FEATURE_SYNC' },
  ...overrides,
});

describe('createCreateReportTool', () => {
  it('stamps walkthrough identity and isolates unresolved sources before saving', async () => {
    const run = makeRun({ promptType: 'code_review' });
    run.setActiveTurn({ turnId: 'review', handler: reviewHandler } as unknown as Turn);
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'walkthrough' });
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const payload = {
      reportType: 'CHANGE_WALKTHROUGH',
      summary: 'Changes',
      targetRunId: '11111111-1111-4111-8111-111111111111',
      groups: [
        {
          title: 'Behavior',
          changes: [
            {
              title: 'Permission',
              context: 'Context',
              walkthrough: [
                {
                  explanation: 'Important change',
                  excerpt: {
                    serviceId: '22222222-2222-4222-8222-222222222222',
                    file: 'missing.ts',
                    startLine: 1,
                    endLine: 1,
                    code: 'literal',
                    language: 'typescript',
                    sourceVersion: { kind: 'WORKSPACE' },
                    verification: { status: 'VERIFIED', checkedAt: FIXED_NOW },
                  },
                },
              ],
              behavioralConsequence: 'Access changes',
            },
          ],
        },
      ],
    };
    await tool.execute({
      run,
      runId: run.runId,
      args: makeArgs({ reportType: 'CHANGE_WALKTHROUGH', payload }),
    });
    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          payload: expect.objectContaining({
            targetRunId: run.session.agentic_session_id,
            groups: [
              expect.objectContaining({
                changes: [
                  expect.objectContaining({
                    walkthrough: [
                      expect.objectContaining({
                        excerpt: expect.objectContaining({
                          verification: {
                            status: 'UNRESOLVED',
                            reason: 'Service workspace unavailable',
                          },
                        }),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      }),
    );
    vi.mocked(proxy.create).mockRejectedValueOnce(new Error('Saving unavailable'));
    await expect(
      tool.execute({
        run,
        runId: run.runId,
        args: makeArgs({ reportType: 'CHANGE_WALKTHROUGH', payload }),
      }),
    ).rejects.toThrow('Saving unavailable');
    expect(run.activeTurn?.handler).toBe(reviewHandler);
    expect(
      reviewHandler.reports?.find((report) => report.reportType === 'CHANGE_WALKTHROUGH')?.required,
    ).toBe(true);
    expect(reviewHandler.reports?.find((report) => report.reportType === 'REVIEW')?.required).toBe(
      false,
    );
  });

  it('saves a walkthrough that omits the host-owned run identity and verification', async () => {
    const run = makeRun({ promptType: 'code_review' });
    run.setActiveTurn({ turnId: 'review', handler: reviewHandler } as unknown as Turn);
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'walkthrough' });
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const payload = {
      reportType: 'CHANGE_WALKTHROUGH',
      summary: 'Changes',
      groups: [
        {
          title: 'Behavior',
          changes: [
            {
              title: 'Permission',
              context: 'Context',
              walkthrough: [
                {
                  explanation: 'Important change',
                  excerpt: {
                    serviceId: '22222222-2222-4222-8222-222222222222',
                    file: 'missing.ts',
                    startLine: 1,
                    endLine: 1,
                    code: 'literal',
                    language: 'typescript',
                    sourceVersion: { kind: 'WORKSPACE' },
                  },
                },
              ],
              behavioralConsequence: 'Access changes',
            },
          ],
        },
      ],
    };
    await tool.execute({
      run,
      runId: run.runId,
      args: makeArgs({ reportType: 'CHANGE_WALKTHROUGH', payload }),
    });
    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          payload: expect.objectContaining({
            targetRunId: run.session.agentic_session_id,
            groups: [
              expect.objectContaining({
                changes: [
                  expect.objectContaining({
                    walkthrough: [
                      expect.objectContaining({
                        excerpt: expect.objectContaining({
                          verification: {
                            status: 'UNRESOLVED',
                            reason: 'Service workspace unavailable',
                          },
                        }),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('declares a pass-through tool with the create_report name and required payload fields', () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreateReportTool(proxy);

    expect(tool.kind).toBe('pass_through');
    expect(tool.name).toBe('create_report');
    const schema = tool.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(['reportType', 'audience', 'payload']));
    expect(schema.properties).toHaveProperty('reportType');
    expect(schema.properties).toHaveProperty('audience');
    expect(schema.properties).toHaveProperty('payload');
    expect(schema.properties).toHaveProperty('entities');
    expect(schema.properties).toHaveProperty('agent');
    expect(schema.properties).toHaveProperty('schemaVersion');
  });

  it.each([jointDecision, overlappingDecisions])(
    'forwards valid V2 groups and the envelope version',
    async (payload) => {
      const proxy = makeCreateReportProxy();
      vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'report-groups' });
      const run = makeRun();
      const args = makeArgs({ reportType: 'FEATURE_SYNC_DECISION', schemaVersion: 2, payload });
      await new CreateReportTool(proxy).execute({ runId: 'run-1', run, args });
      expect(proxy.create).toHaveBeenCalledWith(
        expect.objectContaining({ args: { ...args, agent: 'provider-session-1' } }),
      );
      expect(run.appendReportChainEntry).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { reportType: 'FEATURE_SYNC_DECISION', schemaVersion: 1, payload: jointDecision },
    { reportType: 'FEATURE_SYNC_DECISION', payload: jointDecision },
    { reportType: 'FEATURE_SYNC', schemaVersion: 2, payload: jointDecision },
    {
      reportType: 'FEATURE_SYNC_DECISION',
      schemaVersion: 2,
      payload: {
        ...jointDecision,
        decisionGroups: [
          {
            ...jointDecision.decisionGroups[0]!,
            choices: jointDecision.decisionGroups[0]!.choices.map((choice) => ({
              ...choice,
              isNoChange: false,
            })),
          },
        ],
      },
    },
  ])(
    'rejects invalid grouped input before network, emission, or chain effects',
    async (invalid) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const events = new ReportEmissionEvents();
      const listener = vi.fn();
      events.subscribe(listener);
      const proxy = new CreateReportProxy({
        auth: new SubmissionToolAuth(createTestOAuthClient()),
        apiBaseUrl: 'https://api.test/v1',
        fetchImpl,
        reportEmissionEvents: events,
      });
      const run = makeRun();
      await expect(
        new CreateReportTool(proxy).execute({ runId: 'run-1', run, args: makeArgs(invalid) }),
      ).rejects.toThrow('Invalid FEATURE_SYNC_DECISION');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(run.appendReportChainEntry).not.toHaveBeenCalled();
      expect(run.observePersistedPlanReady).not.toHaveBeenCalled();
    },
  );

  it('stamps the run provider session id before proxying, appends a chain entry, and returns the platform content unchanged', async () => {
    const platformContent = makePlatformContent('report-abc');
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: platformContent,
      reportId: 'report-abc',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    const args = makeArgs();

    const result = await tool.execute({ runId: 'run-xyz', args, run });

    expect(proxy.create).toHaveBeenCalledWith({
      runId: 'run-xyz',
      args: {
        ...args,
        agent: 'provider-session-1',
      },
      conversationId: 'conv-test',
      projectId: 'proj-test',
    });
    expect(result.content).toBe(platformContent);

    const appendMock = vi.mocked(run.appendReportChainEntry);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const entry = appendMock.mock.calls[0]![0] as ReportChainEntry;
    expect(entry).toEqual({
      createdAt: FIXED_NOW,
      phase: 'feature_sync_analyze',
      reportId: 'report-abc',
      reportType: 'FEATURE_SYNC',
      summary: 'feature drift detected in auth flow',
      audience: 'EXTERNAL',
    });
  });

  it('omits report agent metadata when the run has no stable provider session id', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-no-agent'),
      reportId: 'report-no-agent',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({ providerSessionId: 'pending_provider' });
    const args = makeArgs({ agent: 'caller-supplied-agent' });

    await tool.execute({ runId: 'run-1', args, run });

    expect(proxy.create).toHaveBeenCalledWith({
      runId: 'run-1',
      args: {
        ...makeArgs(),
      },
      conversationId: 'conv-test',
      projectId: 'proj-test',
    });
  });

  it('uses the run provider session id instead of trusting a caller-supplied report agent', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-authoritative-agent'),
      reportId: 'report-authoritative-agent',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await tool.execute({
      runId: 'run-1',
      args: makeArgs({ agent: 'caller-supplied-agent' }),
      run,
    });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          agent: 'provider-session-1',
        }),
      }),
    );
  });

  it('does not add Turn-local artifact attachment context to the report request', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-turn-context'),
      reportId: 'report-turn-context',
    });
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({ activeTurnId: 'turn-authoritative' });

    await tool.execute({
      runId: 'run-1',
      args: makeArgs(),
      run,
    });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          agent: 'provider-session-1',
        }),
      }),
    );
  });

  it('uses the same carrier-free request after the Turn completion is committed', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-after-completion'),
      reportId: 'report-after-completion',
    });
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({ completedAssistantMessageId: 'completion-message' });

    await tool.execute({
      runId: 'run-1',
      args: makeArgs(),
      run,
    });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ agent: 'provider-session-1' }),
      }),
    );
  });

  it('records PLAN readiness evidence after a PLAN report is persisted', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-plan'),
      reportId: 'report-plan',
    });
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({ promptType: 'startup_session' });

    await tool.execute({
      runId: 'run-1',
      args: makeArgs({ reportType: 'PLAN' }),
      run,
    });

    expect(run.observePersistedPlanReady).toHaveBeenCalledWith('report-plan');
    expect(vi.mocked(run.appendReportChainEntry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(run.observePersistedPlanReady).mock.invocationCallOrder[0]!,
    );
  });

  it('sanitizes IMPLEMENT filesChanged against canonical Run facts and records the service on the chain entry', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-implement'),
      reportId: 'report-implement',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({
      fileChangeProjection: [
        { serviceId: 'service-1', repoRelativePath: 'src/z.ts' },
        { serviceId: 'service-1', repoRelativePath: 'src/a.ts' },
      ],
    });

    await tool.execute({
      runId: 'run-1',
      run,
      args: makeArgs({
        reportType: 'IMPLEMENT',
        payload: {
          reportType: 'IMPLEMENT',
          summary: 'implemented report validation',
          filesChanged: ['/tmp/host.ts', 'src/z.ts', 'src/missing.ts', 'src/a.ts'],
        },
        entities: [
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'SERVICE', entityId: 'service-1', relation: 'CONTEXT' },
        ],
      }),
    });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          payload: expect.objectContaining({
            filesChanged: ['src/a.ts', 'src/z.ts'],
          }),
        }),
      }),
    );
    expect(run.logImplementReportValidation).toHaveBeenCalledWith(
      'local.run.create_report.implement.rejected_files',
      expect.objectContaining({
        rejectedFiles: ['/tmp/host.ts', 'src/missing.ts'],
      }),
    );
    const entry = vi.mocked(run.appendReportChainEntry).mock.calls[0]![0] as ReportChainEntry;
    expect(entry.serviceId).toBe('service-1');
  });

  it('does not persist an IMPLEMENT report when no requested files match canonical Run facts', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-implement'),
      reportId: 'report-implement',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({
      fileChangeProjection: [{ serviceId: 'service-1', repoRelativePath: 'src/a.ts' }],
    });

    const result = await tool.execute({
      runId: 'run-1',
      run,
      args: makeArgs({
        reportType: 'IMPLEMENT',
        payload: {
          reportType: 'IMPLEMENT',
          summary: 'bad report',
          filesChanged: ['/tmp/host.ts', 'src/missing.ts'],
        },
        entities: [{ entityType: 'SERVICE', entityId: 'service-1', relation: 'CONTEXT' }],
      }),
    });

    expect(proxy.create).not.toHaveBeenCalled();
    expect(run.appendReportChainEntry).not.toHaveBeenCalled();
    expect(result.content[0]!['text']).toContain('no-canonical-files-after-validation');
  });

  it('persists one IMPLEMENT report per matching service when service context is omitted', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create)
      .mockResolvedValueOnce({ content: makePlatformContent('report-a'), reportId: 'report-a' })
      .mockResolvedValueOnce({ content: makePlatformContent('report-b'), reportId: 'report-b' });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun({
      fileChangeProjection: [
        { serviceId: 'service-a', repoRelativePath: 'src/shared.ts' },
        { serviceId: 'service-b', repoRelativePath: 'src/shared.ts' },
      ],
    });

    const result = await tool.execute({
      runId: 'run-1',
      run,
      args: makeArgs({
        reportType: 'IMPLEMENT',
        payload: {
          reportType: 'IMPLEMENT',
          summary: 'multi-service report',
          filesChanged: ['src/shared.ts'],
        },
        entities: [
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'AGENT_SESSION', entityId: 'session-1', relation: 'CONTEXT' },
        ],
      }),
    });

    expect(proxy.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(proxy.create).mock.calls.map(([call]) => call.args)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ filesChanged: ['src/shared.ts'] }),
        entities: expect.arrayContaining([
          expect.objectContaining({ entityType: 'TASK', entityId: 'task-1' }),
          expect.objectContaining({ entityType: 'AGENT_SESSION', entityId: 'session-1' }),
          expect.objectContaining({ entityType: 'SERVICE', entityId: 'service-a' }),
        ]),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({ filesChanged: ['src/shared.ts'] }),
        entities: expect.arrayContaining([
          expect.objectContaining({ entityType: 'TASK', entityId: 'task-1' }),
          expect.objectContaining({ entityType: 'AGENT_SESSION', entityId: 'session-1' }),
          expect.objectContaining({ entityType: 'SERVICE', entityId: 'service-b' }),
        ]),
      }),
    ]);
    expect(result.content).toEqual([
      ...makePlatformContent('report-a'),
      ...makePlatformContent('report-b'),
    ]);
    expect(
      vi.mocked(run.appendReportChainEntry).mock.calls.map(([entry]) => entry.serviceId),
    ).toEqual(['service-a', 'service-b']);
  });

  it('fails actionably when explicit Service context has no canonical partition', async () => {
    const proxy = makeCreateReportProxy();
    const run = makeRun({
      fileChangeProjection: [{ serviceId: 'service-a', repoRelativePath: 'src/a.ts' }],
    });

    await expect(
      new CreateReportTool(proxy).execute({
        runId: 'run-1',
        run,
        args: makeArgs({
          reportType: 'IMPLEMENT',
          payload: {
            reportType: 'IMPLEMENT',
            summary: 'unknown service',
            filesChanged: ['src/a.ts'],
          },
          entities: [{ entityType: 'SERVICE', entityId: 'service-b', relation: 'CONTEXT' }],
        }),
      }),
    ).rejects.toThrow('unknown-service-context');
    expect(proxy.create).not.toHaveBeenCalled();
    expect(run.appendReportChainEntry).not.toHaveBeenCalled();
  });

  it('classifies WORKFLOW_ONLY as internal in the report chain', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-internal'),
      reportId: 'report-internal',
    });

    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await tool.execute({
      runId: 'run-1',
      args: makeArgs({ audience: 'WORKFLOW_ONLY' }),
      run,
    });

    const entry = vi.mocked(run.appendReportChainEntry).mock.calls[0]![0] as ReportChainEntry;
    expect(entry.audience).toBe('INTERNAL');
  });

  it('throws when ctx.run is absent', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreateReportTool(proxy);

    await expect(tool.execute({ runId: 'run-1', args: makeArgs() })).rejects.toThrow(
      /ctx\.run is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when run.session.promptType is unset', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreateReportTool(proxy);
    const run = makeRun();
    delete run.session.promptType;

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /promptType is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('does not append to the chain when the platform proxy throws', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockRejectedValue(new Error('platform 503'));
    const tool = new CreateReportTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({ runId: 'run-1', args: makeArgs({ reportType: 'PLAN' }), run }),
    ).rejects.toThrow(/platform 503/);

    expect(run.appendReportChainEntry).not.toHaveBeenCalled();
    expect(run.observePersistedPlanReady).not.toHaveBeenCalled();
  });
});
