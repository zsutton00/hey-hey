import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { FlowContext } from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { LLMProviderName, SyntheticModel } from 'src/services/llm/llm-shared';
import { SubfacetSummarizationNode } from '../subfacet-summarization.node';

describe('SubfacetSummarizationNode', () => {
  const organizationId = TestUtils.testIds.organization;
  const baseContext: FlowContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      organizationId,
    },
  });

  const mockEntitySummaryService = {
    getCurrentSummariesForSubfacet: jest.fn(),
    getSubfacetCurrentSummaryCounts: jest.fn(),
  };
  const mockSubfacetService = {
    getSubfacetById: jest.fn(),
    updateSummary: jest.fn(),
  };
  const mockAuditService = {
    recordSubfacetSummaryRun: jest.fn(),
  };

  const node = new SubfacetSummarizationNode(
    mockEntitySummaryService as any,
    mockSubfacetService as any,
    mockAuditService as any,
  );

  const promptBuilder = new PromptBuilderService(
    {} as any,
    {} as any,
    new StandardPromptBuilderStrategy({} as any),
    {} as any,
    new PlaceholderResolver(),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses synthetic kimi defaults for subfacet summarization prompts', () => {
    expect(node.promptConfig.temperature).toBe(0.1);
    expect(node.promptConfig.topP).toBe(0.9);
    expect(node.promptConfig.reasoningEffort).toBe('low');
    expect(node.promptConfig.maxTokens).toBe(5000);
    expect(node.promptConfig.responseFormat).toBeNull();
    expect(node.promptConfig.modelCriteria).toEqual({
      provider: LLMProviderName.SYNTHETIC,
      model: SyntheticModel.KIMI_K2_5,
    });
  });

  it('builds a complete system prompt (snapshot)', async () => {
    mockSubfacetService.getSubfacetById.mockResolvedValue({
      id: 'sf-1',
      name: 'Telemetry',
      slug: 'telemetry',
      category: 'technology',
      summary: 'Existing telemetry summary.',
      lastSummarizedAt: new Date('2025-01-10T00:00:00.000Z'),
    });

    mockEntitySummaryService.getCurrentSummariesForSubfacet.mockResolvedValue([
      {
        entityType: 'TASK',
        entityId: 'task-1',
        summary: 'Telemetry spans logs and traces for service health.',
        updatedAt: new Date('2025-01-11T00:00:00.000Z'),
      },
      {
        entityType: 'TASK',
        entityId: 'task-2',
        summary: 'Alerting rules unify thresholds and escalation.',
        updatedAt: new Date('2025-01-12T00:00:00.000Z'),
      },
    ]);
    mockEntitySummaryService.getSubfacetCurrentSummaryCounts.mockResolvedValue({
      totalCurrent: 12,
      changedSinceCutoff: 2,
    });

    const context = {
      ...baseContext,
      subfacetId: 'sf-1',
      summarizationSince: '2025-01-10T00:00:00Z',
      maxEntities: 5,
    } as any;

    const tracker = createMutableContextHandle<FlowContext>(context);
    await node.beforeGeneration(tracker);

    const prompt = await promptBuilder.buildPrompt(node, tracker);

    expect(prompt.systemPrompt).toMatchSnapshot();
    expect(
      mockEntitySummaryService.getCurrentSummariesForSubfacet,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ subfacetId: 'sf-1', take: 5 }),
    );
    expect(
      mockEntitySummaryService.getSubfacetCurrentSummaryCounts,
    ).toHaveBeenCalledWith(expect.objectContaining({ subfacetId: 'sf-1' }));
  });

  it('processes the LLM response and records the audit', async () => {
    const systemMessageData = {
      category: 'technology',
      subfacet: 'Telemetry',
      summary: 'New telemetry rollup.',
      entities: ['task-1'],
      criticalInsights: ['Alerting aligned with telemetry signals'],
    };

    const snapshot = [
      {
        entityId: 'task-1',
        entityType: 'TASK',
        summary: 'Telemetry spans logs and traces.',
        lastUpdated: '2025-01-12T00:00:00.000Z',
      },
    ];

    const context = {
      ...baseContext,
      subfacetId: 'sf-1',
      subfacetName: 'Telemetry',
      summarizationCategory: 'technology',
      summarizationSince: '2025-01-11T00:00:00.000Z',
      maxEntities: 4,
      previousSubfacetSummary: {
        summary: 'Previous telemetry summary.',
        lastSummarizedAt: new Date('2025-01-10T00:00:00.000Z'),
      },
      entitySummarySnapshot: snapshot,
    } as any;

    const tracker = createMutableContextHandle<FlowContext>(context);

    const result = await node.processLlmResponse(
      systemMessageData as any,
      undefined,
      tracker,
    );

    expect(mockSubfacetService.updateSummary).toHaveBeenCalledWith({
      subfacetId: 'sf-1',
      summary: systemMessageData.summary,
    });

    expect(mockAuditService.recordSubfacetSummaryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        projectId: context.core.projectId,
        category: 'technology',
        subfacetId: 'sf-1',
        thresholdApplied: 4,
        accumulatedSnapshot: snapshot,
        consolidatedBefore: context.previousSubfacetSummary,
        consolidationResult: systemMessageData,
      }),
    );

    expect(result.modifiedResult).toEqual(systemMessageData);
  });

  it('uses initial synthesis tasks when no existing subfacet summary exists', async () => {
    mockSubfacetService.getSubfacetById.mockResolvedValue({
      id: 'sf-1',
      name: 'Telemetry',
      slug: 'telemetry',
      category: 'technology',
      summary: null,
      lastSummarizedAt: null,
    });
    mockEntitySummaryService.getCurrentSummariesForSubfacet.mockResolvedValue([
      {
        entityType: 'TASK',
        entityId: 'task-1',
        summary: 'Telemetry spans logs and traces for service health.',
        updatedAt: new Date('2025-01-11T00:00:00.000Z'),
      },
    ]);
    mockEntitySummaryService.getSubfacetCurrentSummaryCounts.mockResolvedValue({
      totalCurrent: 1,
      changedSinceCutoff: 1,
    });

    const context = {
      ...baseContext,
      subfacetId: 'sf-1',
      summarizationSince: '2025-01-10T00:00:00Z',
      maxEntities: 5,
    } as any;

    const tracker = createMutableContextHandle<FlowContext>(context);
    await node.beforeGeneration(tracker);
    const prompt = await promptBuilder.buildPrompt(node, tracker);

    expect(prompt.systemPrompt).toContain(
      'Create an initial subfacet summary from the provided entity summaries.',
    );
    expect(prompt.systemPrompt).not.toContain(
      'Treat the current subfacet summary as the baseline state',
    );
  });

  it('skips shouldRun when changed entity count is zero', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      changedEntityCount: 0,
    } as any);

    await expect(node.shouldRun(tracker)).resolves.toEqual({
      run: false,
      reason:
        'Skip subfacet summarization: no changed entity summaries since cutoff',
    });
  });

  it('runs shouldRun when changed entity count is positive', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      changedEntityCount: 3,
    } as any);

    await expect(node.shouldRun(tracker)).resolves.toEqual({
      run: true,
      reason: 'Changed entity summaries since cutoff: 3',
    });
  });
});
