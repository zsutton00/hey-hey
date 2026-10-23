import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { FlowContext } from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { CategorySummarizationNode } from '../category-summarization.node';

describe('CategorySummarizationNode', () => {
  const organizationId = TestUtils.testIds.organization;
  const baseContext: FlowContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      organizationId,
    },
  });
  const projectId = baseContext.core.projectId;

  const mockSubfacetService = {
    listSubfacets: jest.fn(),
  };
  const mockCategorySummaryService = {
    getCurrentSummary: jest.fn(),
    upsertSummary: jest.fn(),
  };
  const mockAuditService = {
    recordCategoryRun: jest.fn(),
  };
  const mockEntitySummaryService = {
    getCurrentSummariesByCategory: jest.fn(),
  };

  const node = new CategorySummarizationNode(
    mockSubfacetService as any,
    mockEntitySummaryService as any,
    mockCategorySummaryService as any,
    mockAuditService as any,
  );

  it('uses claude haiku defaults for category summarization prompts', () => {
    expect(node.promptConfig.temperature).toBe(0.1);
    expect(node.promptConfig.maxTokens).toBe(5000);
    expect(node.promptConfig.responseFormat).toBeNull();
    expect(node.promptConfig.modelCriteria).toEqual({
      provider: LLMProviderName.CLAUDE,
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
    });
  });

  it('throws when summarizationCategory is missing', () => {
    const context = baseContext as any;

    expect(() => (node as any).buildSystemPrompt(context)).toThrow(
      'summarizationCategory is required',
    );
  });

  it('builds a complete system prompt (snapshot)', async () => {
    mockSubfacetService.listSubfacets.mockResolvedValue([
      {
        id: 'sf-telemetry',
        name: 'Telemetry',
        slug: 'telemetry',
        category: 'technology',
        status: 'ACTIVE',
        summary: 'Telemetry spans logs and traces for service health.',
        createdAt: new Date('2025-01-05T00:00:00.000Z'),
        updatedAt: new Date('2025-01-12T00:00:00.000Z'),
        lastSummarizedAt: new Date('2025-01-12T00:00:00.000Z'),
      },
      {
        id: 'sf-alerting',
        name: 'Alerting',
        slug: 'alerting',
        category: 'technology',
        status: 'ACTIVE',
        summary: 'Alerting rules unify on-call thresholds and escalation.',
        createdAt: new Date('2025-01-06T00:00:00.000Z'),
        updatedAt: new Date('2025-01-09T00:00:00.000Z'),
        lastSummarizedAt: new Date('2025-01-09T00:00:00.000Z'),
      },
    ]);
    mockCategorySummaryService.getCurrentSummary.mockResolvedValue({
      summary:
        'Observability work clusters around telemetry and alerting coverage.',
      lastUpdated: new Date('2025-01-13T00:00:00.000Z'),
    });

    const promptBuilder = new PromptBuilderService(
      {} as any,
      {} as any,
      new StandardPromptBuilderStrategy({} as any),
      {} as any,
      new PlaceholderResolver(),
      {} as any,
      {} as any,
      {} as any,
      mockEntitySummaryService as any,
      mockSubfacetService as any,
      {} as any,
      {} as any,
    );

    const context = {
      ...baseContext,
      summarizationCategory: 'technology',
      summarizationSince: '2025-01-11T00:00:00Z',
      maxPerCategory: 12,
    } as any;

    const tracker = createMutableContextHandle<FlowContext>(context);
    await node.beforeGeneration(tracker);

    const prompt = await promptBuilder.buildPrompt(node, tracker);

    expect(prompt.systemPrompt).toMatchSnapshot();
    expect(mockSubfacetService.listSubfacets).toHaveBeenCalledTimes(1);
  });

  it('processes the LLM response and records the audit', async () => {
    const systemMessageData = {
      category: 'technology',
      summary: 'Unified summary for technology focus.',
      briefSummary:
        'Technology centers on an event-driven platform that links graph and semantic context, real-time collaboration, and agent-facing workflows.',
      subfacets: ['Telemetry', 'Alerting'],
      crossCuttingThemes: ['Observability reliability'],
      criticalInsights: ['Alerting thresholds standardized'],
    };

    const previousSummary = {
      summary: 'Previous category summary.',
      briefSummary: 'Previous brief category summary.',
      lastUpdated: new Date('2025-01-10T00:00:00.000Z'),
    };

    const snapshot = [
      {
        subfacet: 'Telemetry',
        summary: 'Telemetry spans logs and traces.',
        lastSummarizedAt: '2025-01-12T00:00:00.000Z',
        updatedSinceCutoff: true,
        isNew: false,
      },
    ];

    const context = {
      ...baseContext,
      summarizationCategory: 'technology',
      summarizationSince: '2025-01-11T00:00:00.000Z',
      maxPerCategory: 12,
      previousCategorySummary: previousSummary,
      subfacetSummarySnapshot: snapshot,
    } as any;

    const tracker = createMutableContextHandle<FlowContext>(context);

    const result = await node.processLlmResponse(
      systemMessageData as any,
      undefined,
      tracker,
    );

    expect(mockCategorySummaryService.upsertSummary).toHaveBeenCalledWith({
      organizationId,
      projectId,
      category: 'technology',
      summary: systemMessageData.summary,
      briefSummary: systemMessageData.briefSummary,
    });

    expect(mockAuditService.recordCategoryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        projectId,
        category: 'technology',
        since: new Date('2025-01-11T00:00:00.000Z'),
        thresholdApplied: 1,
        accumulatedSnapshot: snapshot,
        consolidatedBefore: previousSummary,
        consolidationResult: systemMessageData,
      }),
    );

    expect(result.modifiedResult).toEqual(systemMessageData);
  });
});
