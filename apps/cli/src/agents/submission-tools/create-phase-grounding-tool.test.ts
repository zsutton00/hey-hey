import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreatePhaseGroundingTool } from './create-phase-grounding-tool';
import { makeCreateReportProxy } from './create-report-proxy.test-support';
import { createTestRun } from '../../run/run.test-support';
import type { ReportChainEntry } from '../../run/types';
import type { SubmissionToolMcpContent } from './types';

const FIXED_NOW = '2026-05-02T12:00:00.000Z';

const makeRun = () => {
  const run = createTestRun({ conversationId: 'conv-test', projectId: 'proj-test' });
  run.session.promptType = 'plan_shaping_phase_breakdown';
  vi.spyOn(run, 'appendReportChainEntry').mockImplementation(() => undefined);
  return run;
};

const makeArgs = (overrides?: Record<string, unknown>): Record<string, unknown> => ({
  touchPoints: [
    {
      file: 'cli/src/agents/plan-shaping/submission-tools.ts',
      expectedOutcome: 'Drop the substring-match loop.',
    },
  ],
  summary: 'phase grounding for the auth wiring',
  ...overrides,
});

const makePlatformContent = (id: string): SubmissionToolMcpContent[] => [
  {
    type: 'text',
    text: JSON.stringify({ id, status: 'created' }),
  },
];

describe('createCreatePhaseGroundingTool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('declares a pass-through tool with the create_phase_grounding name and the narrowed input schema', () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreatePhaseGroundingTool(proxy);

    expect(tool.kind).toBe('pass_through');
    expect(tool.name).toBe('create_phase_grounding');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['touchPoints'],
    });
    const schema = tool.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('touchPoints');
    expect(schema.properties).not.toHaveProperty('reportType');
    expect(schema.properties).not.toHaveProperty('audience');
    expect(schema.properties).not.toHaveProperty('payload');
  });

  it('assembles platform args server-side, appends a chain entry, and returns the platform content unchanged', async () => {
    const platformContent = makePlatformContent('report-123');
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: platformContent,
      reportId: 'report-123',
    });

    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    const args = makeArgs();

    const result = await tool.execute({ runId: 'run-xyz', args, run });

    expect(proxy.create).toHaveBeenCalledWith({
      runId: 'run-xyz',
      args: {
        reportType: 'PHASE_GROUNDING',
        audience: 'WORKFLOW_ONLY',
        payload: {
          reportType: 'PHASE_GROUNDING',
          summary: 'phase grounding for the auth wiring',
          touchPoints: [
            {
              file: 'cli/src/agents/plan-shaping/submission-tools.ts',
              expectedOutcome: 'Drop the substring-match loop.',
            },
          ],
        },
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
      phase: 'plan_shaping_phase_breakdown',
      reportId: 'report-123',
      reportType: 'PHASE_GROUNDING',
      summary: 'phase grounding for the auth wiring',
      audience: 'INTERNAL',
      touchPoints: [
        {
          file: 'cli/src/agents/plan-shaping/submission-tools.ts',
          expectedOutcome: 'Drop the substring-match loop.',
        },
      ],
    });
  });

  it('forwards planAdjustment to the platform payload when provided', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-adj'),
      reportId: 'report-adj',
    });
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await tool.execute({
      runId: 'run-1',
      args: makeArgs({ planAdjustment: 'No surface change — verified intact.' }),
      run,
    });

    const callArgs = vi.mocked(proxy.create).mock.calls[0]![0];
    expect(callArgs.args).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          planAdjustment: 'No surface change — verified intact.',
        }),
      }),
    );
  });

  it('falls back to an empty summary when the caller passes no summary', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-no-summary'),
      reportId: 'report-no-summary',
    });
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    const args = makeArgs();
    delete (args as Record<string, unknown>)['summary'];

    await tool.execute({
      runId: 'run-1',
      args,
      run,
    });

    const callArgs = vi.mocked(proxy.create).mock.calls[0]![0];
    expect(callArgs.args).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ summary: '' }) }),
    );

    const entry = vi.mocked(run.appendReportChainEntry).mock.calls[0]![0] as ReportChainEntry;
    expect(entry.summary).toBe('');
  });

  it('throws when ctx.run is absent — pass-through tools are useless without a Run', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);

    await expect(tool.execute({ runId: 'run-1', args: makeArgs() })).rejects.toThrow(
      /ctx\.run is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('throws when run.session.promptType is unset — phase is required for the chain entry', async () => {
    const proxy = makeCreateReportProxy();
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    delete run.session.promptType;

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /promptType is required/,
    );
    expect(proxy.create).not.toHaveBeenCalled();
  });

  it('does not append to the chain when the platform proxy throws — agent sees the proxy error', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockRejectedValue(new Error('platform 500'));
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /platform 500/,
    );

    expect(run.appendReportChainEntry).not.toHaveBeenCalled();
  });

  it('surfaces a chain-append failure even though the platform persisted the report', async () => {
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create).mockResolvedValue({
      content: makePlatformContent('report-orphan'),
      reportId: 'report-orphan',
    });
    const tool = new CreatePhaseGroundingTool(proxy, () => FIXED_NOW);
    const run = makeRun();
    vi.mocked(run.appendReportChainEntry).mockImplementationOnce(() => {
      throw new Error('chain entry rejected');
    });

    await expect(tool.execute({ runId: 'run-1', args: makeArgs(), run })).rejects.toThrow(
      /chain entry rejected/,
    );
  });
});
