import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodingResearchTool } from './create-coding-research-tool';
import { makeCreateReportProxy } from './create-report-proxy.test-support';
import { createTestRun } from '../../run/run.test-support';
import type { RunMemo } from '../../session/types';
import type { SubmissionToolMcpContent } from './types';

const FIXED_NOW = '2026-06-17T10:00:00.000Z';

const makeRun = () => {
  const run = createTestRun({ conversationId: 'conv-test', projectId: 'proj-test' });
  run.session.promptType = 'project_assistant';
  vi.spyOn(run, 'appendReportChainEntry').mockImplementation(() => undefined);
  vi.spyOn(run, 'appendMemo').mockImplementation(() => undefined);
  return run;
};

const SAMPLE_FRAME = {
  focalId: 'task-abc',
  nodes: [
    {
      id: 'task-abc',
      type: 'STANDARD',
      title: 'Implement bootstrap',
      content: '...',
      contentSource: 'original',
      edges: [],
    },
  ],
};

const SAMPLE_PROVENANCE = {
  discoveryCalls: [
    { tool: 'unified_search', query: 'project assistant research', intent: 'locate related tasks' },
  ],
  edgesTraversed: [
    { fromId: 'task-abc', toId: 'feature-xyz', reasoning: 'parent feature carries contracts' },
  ],
};

const SAMPLE_UPDATES = [
  {
    type: 'update',
    targets: [{ entityType: 'TASK', entityId: 'task-abc', title: 'Implement bootstrap' }],
    description: 'Align the bootstrap acceptance criteria with the persisted research handoff.',
    reason:
      'The focal task and its existing report boundary describe the same missing handoff field.',
  },
];

const makeArgs = (overrides?: Record<string, unknown>): Record<string, unknown> => ({
  frame: SAMPLE_FRAME,
  analysis:
    'The task sits under Session Bootstrap. Key contracts: recordPreviousProviderSession injection.',
  summary: 'Project Assistant complete. Coding agent should focus on run.ts handleMessage gate.',
  provenance: SAMPLE_PROVENANCE,
  updates: SAMPLE_UPDATES,
  readinessEvidence: [],
  ...overrides,
});

const makePlatformContent = (id: string): SubmissionToolMcpContent[] => [
  { type: 'text', text: JSON.stringify({ id, status: 'created' }) },
];

describe('createCodingResearchTool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('declares a pass_through tool named create_coding_research with required research output fields', () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy);

    expect(tool.kind).toBe('pass_through');
    expect(tool.name).toBe('create_coding_research');
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain('frame');
    expect(schema.required).toContain('analysis');
    expect(schema.required).toContain('summary');
    expect(schema.required).toContain('provenance');
    expect(schema.required).toContain('updates');
    expect(schema.required).toContain('readinessEvidence');
    expect(schema.properties).not.toHaveProperty('reportType');
    expect(schema.properties).not.toHaveProperty('audience');
  });

  it('posts CODING_RESEARCH, records it for turn-end attachment, and appends its memo', async () => {
    const platformContent = makePlatformContent('report-cr-001');
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: platformContent,
      reportId: 'report-cr-001',
    });

    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    const args = makeArgs();

    const result = await tool.execute({ runId: 'run-xyz', args, run });

    // Proxy receives the CODING_RESEARCH platform call
    expect(proxy.create).toHaveBeenCalledWith({
      runId: 'run-xyz',
      args: {
        reportType: 'CODING_RESEARCH',
        audience: 'PROJECT_VISIBLE',
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: args['summary'],
          frame: SAMPLE_FRAME,
          analysis: args['analysis'],
          provenance: SAMPLE_PROVENANCE,
          updates: SAMPLE_UPDATES,
          readinessEvidence: [],
        },
      },
      conversationId: 'conv-test',
      projectId: 'proj-test',
    });

    // Returns analysis as the visible tool content
    expect(result.content).toEqual([{ type: 'text', text: args['analysis'] }]);

    expect(run.appendReportChainEntry).toHaveBeenCalledWith({
      createdAt: FIXED_NOW,
      phase: 'project_assistant',
      reportId: 'report-cr-001',
      reportType: 'CODING_RESEARCH',
      summary: args['summary'],
      audience: 'EXTERNAL',
    });

    // The producer also appends one memo directly, carrying the frame JSON and
    // analysis and labelled by the active phase.
    expect(run.appendMemo).toHaveBeenCalledTimes(1);
    const memo = vi.mocked(run.appendMemo).mock.calls[0]![0] as RunMemo;
    expect(memo.source).toBe('project_assistant');
    expect(memo.writtenAt).toBe(FIXED_NOW);
    expect(memo.content).toContain(JSON.stringify(SAMPLE_FRAME, null, 2));
    expect(memo.content).toContain(JSON.stringify(SAMPLE_UPDATES, null, 2));
    expect(memo.content).toContain(args['analysis'] as string);
  });

  it('persists an explicit empty updates array without adding a placeholder candidate', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-cr-empty'),
      reportId: 'report-cr-empty',
    });

    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await tool.execute({ runId: 'run-empty', args: makeArgs({ updates: [] }), run });

    expect(proxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          payload: expect.objectContaining({ updates: [] }),
        }),
      }),
    );
    const memo = vi.mocked(run.appendMemo).mock.calls[0]![0] as RunMemo;
    expect(memo.content).toContain('## Reconciliation updates');
    expect(memo.content).toContain('## Reconciliation updates\n```json\n[]\n```');
  });

  it('carries bounded implementation-readiness evidence into the downstream memo', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-cr-readiness'),
      reportId: 'report-cr-readiness',
    });

    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    const evidence = [
      {
        category: 'behavior',
        statement: 'The task leaves two possible observable outcomes.',
        sourceRef: 'task.description',
      },
    ];

    await tool.execute({
      runId: 'run-readiness',
      args: makeArgs({ readinessEvidence: evidence }),
      run,
    });

    const memo = vi.mocked(run.appendMemo).mock.calls[0]![0] as RunMemo;
    expect(memo.content).toContain('## Implementation-readiness evidence');
    expect(memo.content).toContain(JSON.stringify(evidence, null, 2));
  });

  it('throws when ctx.run is absent', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);

    await expect(tool.execute({ runId: 'run-1', args: makeArgs() })).rejects.toThrow(
      /ctx\.run is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when run.session.promptType is absent', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    delete run.session.promptType;

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /promptType is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when analysis is missing or empty', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({ runId: 'run-1', args: makeArgs({ analysis: '' }), run }),
    ).rejects.toThrow(/analysis must be a non-empty string/);
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when summary is missing or empty', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({ runId: 'run-1', args: makeArgs({ summary: '' }), run }),
    ).rejects.toThrow(/summary must be a non-empty string/);
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('reports the precise provenance path when edgesTraversed is misplaced or missing', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({
        runId: 'run-1',
        args: makeArgs({
          provenance: { discoveryCalls: SAMPLE_PROVENANCE.discoveryCalls },
          edgesTraversed: SAMPLE_PROVENANCE.edgesTraversed,
        }),
        run,
      }),
    ).rejects.toThrow(/provenance\.edgesTraversed:.*Required/);
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when updates are missing or malformed', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({ runId: 'run-1', args: makeArgs({ updates: undefined }), run }),
    ).rejects.toThrow(/updates must be an array of typed advisory candidates/);
    await expect(
      tool.execute({
        runId: 'run-1',
        args: makeArgs({
          updates: [
            {
              type: 'update',
              targets: [{ entityType: 'TASK', entityId: 'task-abc', title: '' }],
              description: 'Candidate',
              reason: 'Evidence',
            },
          ],
        }),
        run,
      }),
    ).rejects.toThrow(/updates must be an array of typed advisory candidates/);
    await expect(
      tool.execute({
        runId: 'run-1',
        args: makeArgs({
          updates: [
            {
              type: 'update',
              targets: [{ entityType: 'USER', entityId: 'user-1', title: 'Researcher' }],
              description: 'Candidate',
              reason: 'Evidence',
            },
          ],
        }),
        run,
      }),
    ).rejects.toThrow(/updates must be an array of typed advisory candidates/);
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('rejects readiness evidence that is untyped or exceeds the bounded limit', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(
      tool.execute({
        runId: 'run-1',
        args: makeArgs({
          readinessEvidence: Array.from({ length: 9 }, (_, index) => ({
            category: 'behavior',
            statement: `Evidence ${index}`,
          })),
        }),
        run,
      }),
    ).rejects.toThrow(/readinessEvidence must be a bounded typed evidence array/);

    await expect(
      tool.execute({
        runId: 'run-1',
        args: makeArgs({
          readinessEvidence: [
            { category: 'ownership', statement: 'This is no longer a readiness category.' },
          ],
        }),
        run,
      }),
    ).rejects.toThrow(/readinessEvidence must be a bounded typed evidence array/);

    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('does not append a memo when the proxy throws', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockRejectedValue(new Error('platform 503'));
    const tool = new CodingResearchTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /platform 503/,
    );

    expect(run.appendMemo).not.toHaveBeenCalled();
    expect(run.appendReportChainEntry).not.toHaveBeenCalled();
  });
});
