import { SummaryCategory, SubfacetStatus } from '@prisma/client';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { SubfacetConsolidationNode } from '../subfacet-consolidation.node';
import * as TestUtils from 'src/utils/testUtils';
import { FlowContext } from 'src/types/flow-internal.types';
import { LLMProviderName, SyntheticModel } from 'src/services/llm/llm-shared';
import {
  createPreConsolidationSubfacets,
  createConsolidationLlmOutput,
  createPreConsolidationEntitySummaries,
  expectedDeprecatedSubfacetNames,
  fixtureIds,
} from './fixtures';

describe('SubfacetConsolidationNode', () => {
  const organizationId = TestUtils.testIds.organization;
  const baseContext: FlowContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      organizationId,
    },
  });
  const projectId = baseContext.core.projectId;

  const mockEntitySummaryService = {
    getCurrentSummariesByCategory: jest.fn(),
    getCurrentSummariesForSubfacet: jest.fn(),
    getCurrentSummariesForSubfacetNames: jest.fn(),
    createSummaryWithSubfacets: jest.fn(),
    removeDeprecatedSubfacetsFromCurrentSummaries: jest.fn().mockResolvedValue({
      processed: 0,
      updated: 0,
      skipped: 0,
    }),
  };

  const mockSubfacetService = {
    createSubfacets: jest.fn(),
    createSubfacetsWithDeduping: jest.fn(),
    deprecateSubfacetsWithMetadata: jest.fn(),
    listSubfacets: jest.fn(),
    listByStatusAndCategory: jest.fn(),
    markSeenInConsolidation: jest.fn(),
    promoteProvisionalsToActive: jest.fn(),
    updateSummary: jest.fn(),
  };

  const mockAuditService = {
    recordRun: jest.fn(),
  };

  const node = new SubfacetConsolidationNode(
    mockEntitySummaryService as any,
    mockSubfacetService as any,
    mockAuditService as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    mockEntitySummaryService.removeDeprecatedSubfacetsFromCurrentSummaries.mockResolvedValue(
      { processed: 0, updated: 0, skipped: 0 },
    );
  });

  it('uses synthetic kimi defaults for consolidation prompts', () => {
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

  it('throws when consolidationSince is missing', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
    } as any);

    await expect(node.beforeGeneration(tracker)).rejects.toThrow(
      'consolidationSince is required',
    );
  });

  it('computes accumulated candidates excluding already consolidated subfacets', async () => {
    const fixedUpdated = new Date('2025-12-16T06:01:53.000Z');
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      { id: 'sf-1', name: 'Alpha', updatedAt: fixedUpdated },
      { id: 'sf-2', name: 'Beta', updatedAt: fixedUpdated },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacet.mockResolvedValue([
      {
        entityType: 'TASK',
        entityId: 'task-2',
        summary: 'candidate beta summary',
        updatedAt: fixedUpdated,
      },
    ]);

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-15T00:00:00Z',
      consolidationThreshold: 7,
      processedSubfacets: ['alpha'],
    } as any);

    await node.beforeGeneration(tracker);

    const ctx = tracker.getContext() as any;
    expect(ctx.consolidationThreshold).toBe(7);
    expect(ctx.consolidationCategory).toBe('technology');
    expect(ctx.consolidationSince).toBe('2025-01-15T00:00:00.000Z');

    expect(ctx.selectedSubfacetNames).toEqual(['Beta']);
    expect(ctx.hasMoreSubfacets).toBe(false);
    expect(ctx.accumulatedSubfacetCount).toBe(1);
    expect(ctx.selectedSubfacetCount).toBe(1);
    expect(
      mockEntitySummaryService.getCurrentSummariesForSubfacet,
    ).toHaveBeenCalledTimes(1);
  });

  it('includes subfacet summary even when there are no recent entity samples', async () => {
    const fixedUpdated = new Date('2025-12-16T06:01:53.000Z');
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      {
        id: 'sf-1',
        name: 'Credential lifecycle',
        updatedAt: fixedUpdated,
        summary:
          'Tracks token storage, refresh, revocation, and secure persistence behavior.',
      },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacet.mockResolvedValue(
      [],
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-15T00:00:00Z',
      consolidationThreshold: 3,
    } as any);

    await node.beforeGeneration(tracker);
    const ctx = tracker.getContext() as any;

    expect(ctx.selectedSubfacetNames).toEqual(['Credential lifecycle']);
    expect(ctx.accumulatedSubfacetCount).toBe(1);
    expect(ctx.selectedSubfacetCount).toBe(1);
    expect(ctx.selectedSubfacetBlock).toContain(
      'summary: Tracks token storage, refresh, revocation, and secure persistence behavior.',
    );
  });

  it('persists audit row in processLlmResponse', async () => {
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      { id: 'sf-1', name: 'Alpha', slug: 'alpha', category: 'technology' },
      { id: 'sf-4', name: 'Delta', slug: 'delta', category: 'technology' },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
      [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          summary: 'existing summary alpha',
          category: 'technology',
          updatedAt: new Date('2025-01-01T00:00:00Z'),
          subfacets: [{ id: 'sf-1', name: 'Alpha', updatedAt: new Date() }],
        },
        {
          entityType: 'TASK',
          entityId: 'task-2',
          summary: 'existing summary beta',
          category: 'technology',
          updatedAt: new Date('2025-01-02T00:00:00Z'),
          subfacets: [
            { id: 'sf-2', name: 'Beta', updatedAt: new Date() },
            { id: 'sf-3', name: 'Gamma', updatedAt: new Date() },
          ],
        },
      ],
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-01T00:00:00Z',
      consolidationThreshold: 5,
      accumulatedSubfacetsJson: '[]',
      accumulatedSubfacetCount: 6,
      consolidatedSubfacetsSnapshot: [{ stub: true }],
    } as any);

    const response = {
      category: 'technology',
      mergedSubfacets: [
        {
          name: 'Delta',
          mergedFrom: ['Alpha'],
          summary: 'merged summary',
          justification: 'merge',
        },
      ],
      keptSubfacets: [] as Array<{ name: string; reasonKept: string }>,
      notes: [] as string[],
    };

    await node.processLlmResponse(response as any, undefined, tracker);

    expect(mockSubfacetService.createSubfacets).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        names: ['Delta'],
        organizationId,
        projectId: baseContext.core.projectId,
      }),
    );
    expect(
      mockSubfacetService.deprecateSubfacetsWithMetadata,
    ).toHaveBeenCalledWith({
      category: 'technology',
      organizationId,
      projectId: baseContext.core.projectId,
      names: ['Alpha'],
    });
    expect(mockSubfacetService.markSeenInConsolidation).toHaveBeenCalled();
    expect(mockSubfacetService.promoteProvisionalsToActive).toHaveBeenCalled();

    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockEntitySummaryService.getCurrentSummariesForSubfacetNames,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        subfacetNames: ['Alpha'],
        statuses: ['ACTIVE', 'PROVISIONAL'],
      }),
    );
    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'task-1',
        subfacets: ['Delta'],
      }),
    );
    expect(mockAuditService.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        projectId,
        category: 'technology',
        thresholdApplied: 5,
        consolidationResult: expect.objectContaining({
          triggered: true,
          skipReason: undefined,
        }),
        consolidatedBefore: [{ stub: true }],
      }),
    );
  });

  it('calls removeDeprecatedSubfacetsFromCurrentSummaries after deprecation', async () => {
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      { id: 'sf-1', name: 'Alpha', slug: 'alpha', category: 'technology' },
      { id: 'sf-4', name: 'Delta', slug: 'delta', category: 'technology' },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
      [],
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-01T00:00:00Z',
      consolidationThreshold: 24,
      accumulatedSubfacetsJson: '[]',
      accumulatedSubfacetCount: 30,
      consolidatedSubfacetsSnapshot: [{ stub: true }],
    } as any);

    await node.processLlmResponse(
      {
        category: 'technology',
        mergedSubfacets: [
          {
            name: 'Delta',
            mergedFrom: ['Alpha'],
            summary: 'merged summary',
            justification: 'merge',
          },
        ],
        keptSubfacets: [],
        notes: [],
      } as any,
      undefined,
      tracker,
    );

    expect(
      mockEntitySummaryService.removeDeprecatedSubfacetsFromCurrentSummaries,
    ).toHaveBeenCalledWith({
      organizationId,
      projectId: baseContext.core.projectId,
      category: 'technology',
    });
  });

  it('marks kept subfacets as seen and promotes provisionals even when there are no merges', async () => {
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      {
        id: 'sf-keep',
        name: 'Keep Facet',
        slug: 'keep-facet',
        category: 'technology',
      },
      {
        id: 'sf-other',
        name: 'Other Facet',
        slug: 'other-facet',
        category: 'technology',
      },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
      [],
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-01T00:00:00Z',
      consolidationThreshold: 5,
      accumulatedSubfacetsJson: '[]',
      accumulatedSubfacetCount: 6,
      consolidatedSubfacetsSnapshot: [{ stub: true }],
    } as any);

    await node.processLlmResponse(
      {
        category: 'technology',
        mergedSubfacets: [],
        keptSubfacets: [{ name: 'Keep Facet', reasonKept: 'distinct scope' }],
        notes: [],
      } as any,
      undefined,
      tracker,
    );

    expect(mockSubfacetService.createSubfacets).not.toHaveBeenCalled();
    expect(
      mockSubfacetService.deprecateSubfacetsWithMetadata,
    ).not.toHaveBeenCalled();
    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).not.toHaveBeenCalled();
    expect(mockSubfacetService.markSeenInConsolidation).toHaveBeenCalledWith(
      expect.objectContaining({
        subfacetIds: ['sf-keep'],
      }),
    );
    expect(
      mockSubfacetService.promoteProvisionalsToActive,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
      }),
    );
  });

  it('normalizes consolidation names that exceed 3 words or include "&"', async () => {
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      {
        id: 'sf-foo',
        name: 'File scanning path',
        slug: 'file-scanning-path',
        category: 'technology',
      },
      {
        id: 'sf-keep',
        name: 'Auth Security',
        slug: 'auth-security',
        category: 'technology',
      },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
      [],
    );
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-01T00:00:00Z',
      consolidationThreshold: 5,
      accumulatedSubfacetsJson: '[]',
      accumulatedSubfacetCount: 6,
      consolidatedSubfacetsSnapshot: [{ stub: true }],
    } as any);

    await node.processLlmResponse(
      {
        category: 'technology',
        mergedSubfacets: [
          {
            name: 'File scanning path resolution',
            mergedFrom: ['Scanner'],
            summary: 'merged summary',
            justification: 'merge',
          },
        ],
        keptSubfacets: [
          { name: 'Auth & Security', reasonKept: 'distinct scope' },
        ],
      } as any,
      undefined,
      tracker,
    );

    expect(mockSubfacetService.createSubfacets).toHaveBeenCalledWith(
      expect.objectContaining({
        names: ['File scanning path'],
      }),
    );
    expect(mockSubfacetService.markSeenInConsolidation).toHaveBeenCalledWith(
      expect.objectContaining({
        subfacetIds: expect.arrayContaining(['sf-foo', 'sf-keep']),
      }),
    );
  });

  it('still fails when normalization cannot produce a valid name', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-01T00:00:00Z',
      consolidationThreshold: 5,
      accumulatedSubfacetsJson: '[]',
      accumulatedSubfacetCount: 6,
      consolidatedSubfacetsSnapshot: [{ stub: true }],
    } as any);

    await expect(
      node.processLlmResponse(
        {
          category: 'technology',
          mergedSubfacets: [
            {
              name: '&',
              mergedFrom: ['Scanner'],
              summary: 'merged summary',
              justification: 'merge',
            },
          ],
          keptSubfacets: [],
        } as any,
        undefined,
        tracker,
      ),
    ).rejects.toThrow('Invalid consolidation response');
  });

  it('runs when proliferation gate is hit even if accumulated is below threshold', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationThreshold: 30,
      accumulatedSubfacetCount: 2,
      activeSubfacetCount: 30,
      previousAudit: { id: 'audit-1' } as any,
    } as any);

    const result = await node.shouldRun(tracker);
    expect(result.run).toBe(true);
    expect((tracker.getContext() as any).consolidationRunGate).toBe(
      'proliferation',
    );
  });

  it('marks selected gate when explicitSubfacetSelection is true', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      selectedSubfacetNames: ['Credential lifecycle'],
      explicitSubfacetSelection: true,
      activeSubfacetCount: 30,
      consolidationThreshold: 24,
    } as any);

    const result = await node.shouldRun(tracker);

    expect(result.run).toBe(true);
    expect((tracker.getContext() as any).consolidationRunGate).toBe('selected');
  });

  it('does NOT fire selected gate when explicitSubfacetSelection is absent', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      selectedSubfacetNames: ['Credential lifecycle'],
      activeSubfacetCount: 30,
      consolidationThreshold: 24,
    } as any);

    const result = await node.shouldRun(tracker);

    expect(result.run).toBe(true);
    // Should hit first_run gate (no previousAudit), not selected
    expect((tracker.getContext() as any).consolidationRunGate).toBe(
      'first_run',
    );
  });

  it('skips when below minimum active subfacet count', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationThreshold: 24,
      accumulatedSubfacetCount: 1,
      activeSubfacetCount: 6,
      previousAudit: { id: 'audit-2' } as any,
    } as any);

    const result = await node.shouldRun(tracker);
    expect(result.run).toBe(false);
    expect(result.reason).toContain('Only 6 active subfacets');
    expect((tracker.getContext() as any).consolidationRunGate).toBeUndefined();
  });

  it('skips when below thresholds and not a first run', async () => {
    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationThreshold: 30,
      accumulatedSubfacetCount: 1,
      activeSubfacetCount: 25,
      previousAudit: { id: 'audit-2' } as any,
    } as any);

    const result = await node.shouldRun(tracker);
    expect(result.run).toBe(false);
    expect((tracker.getContext() as any).consolidationRunGate).toBeUndefined();
  });

  it('builds a complete system prompt (snapshot)', async () => {
    const fixedUpdated = new Date('2025-12-16T06:01:53.000Z');
    mockSubfacetService.listByStatusAndCategory.mockResolvedValue([
      { id: 'sf-1', name: 'Alpha', updatedAt: fixedUpdated },
      { id: 'sf-2', name: 'Beta', updatedAt: fixedUpdated },
    ]);
    mockEntitySummaryService.getCurrentSummariesForSubfacet
      .mockResolvedValueOnce([
        {
          entityType: 'TASK',
          entityId: 'task-1',
          summary: 'existing alpha summary',
          updatedAt: fixedUpdated,
        },
      ])
      .mockResolvedValueOnce([
        {
          entityType: 'TASK',
          entityId: 'task-2',
          summary: 'candidate beta summary',
          updatedAt: fixedUpdated,
        },
      ]);

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2025-01-15T00:00:00Z',
      consolidationThreshold: 3,
    } as any);

    await node.beforeGeneration(tracker);
    const ctx = tracker.getContext() as any;
    const prompt = (node as any).buildSystemPrompt(ctx);

    expect(prompt).toMatchSnapshot();
  });

  describe('applyConsolidation with real fixture data', () => {
    const preSubfacets = createPreConsolidationSubfacets();
    const llmOutput = createConsolidationLlmOutput();
    const preEntities = createPreConsolidationEntitySummaries();
    const deprecatedNames = expectedDeprecatedSubfacetNames();

    it('creates target subfacets for all merged groups', async () => {
      const targetNames = llmOutput.mergedSubfacets.map((m) => m.name);

      // listByStatusAndCategory is called multiple times during applyConsolidation
      mockSubfacetService.listByStatusAndCategory.mockResolvedValue(
        preSubfacets.map((sf) => ({
          ...sf,
          // After createSubfacets, targets exist as ACTIVE alongside originals
          status: SubfacetStatus.ACTIVE,
        })),
      );
      mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
        preEntities.filter((e) =>
          e.subfacets.some((sf) =>
            deprecatedNames.some(
              (dn) => dn.toLowerCase() === sf.name.toLowerCase(),
            ),
          ),
        ),
      );

      const tracker = createMutableContextHandle<FlowContext>({
        ...baseContext,
        consolidationCategory: 'technology' as SummaryCategory,
        consolidationSince: '2026-01-01T00:00:00Z',
        consolidationThreshold: 24,
        accumulatedSubfacetsJson: '[]',
        accumulatedSubfacetCount: preSubfacets.length,
        consolidatedSubfacetsSnapshot: [],
      } as any);

      await node.processLlmResponse(llmOutput as any, undefined, tracker);

      expect(mockSubfacetService.createSubfacets).toHaveBeenCalledWith(
        expect.objectContaining({
          names: targetNames,
          category: 'technology',
          organizationId,
          projectId: baseContext.core.projectId,
        }),
      );
    });

    it('deprecates all mergedFrom subfacets that are not targets', async () => {
      mockSubfacetService.listByStatusAndCategory.mockResolvedValue(
        preSubfacets,
      );
      mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
        [],
      );

      const tracker = createMutableContextHandle<FlowContext>({
        ...baseContext,
        consolidationCategory: 'technology' as SummaryCategory,
        consolidationSince: '2026-01-01T00:00:00Z',
        consolidationThreshold: 24,
        accumulatedSubfacetsJson: '[]',
        accumulatedSubfacetCount: preSubfacets.length,
        consolidatedSubfacetsSnapshot: [],
      } as any);

      await node.processLlmResponse(llmOutput as any, undefined, tracker);

      expect(
        mockSubfacetService.deprecateSubfacetsWithMetadata,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'technology',
          names: expect.arrayContaining(deprecatedNames),
        }),
      );
    });

    it('remaps entities from deprecated subfacets to their merge targets', async () => {
      mockSubfacetService.listByStatusAndCategory.mockResolvedValue(
        preSubfacets,
      );

      // Entity task-001 references "CLI Agent Orchestration" and "CLI Architecture Integration"
      // Both should remap to "CLI Architecture"
      const task001 = preEntities.find((e) => e.entityId === 'task-001')!;
      mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
        [task001],
      );

      const tracker = createMutableContextHandle<FlowContext>({
        ...baseContext,
        consolidationCategory: 'technology' as SummaryCategory,
        consolidationSince: '2026-01-01T00:00:00Z',
        consolidationThreshold: 24,
        accumulatedSubfacetsJson: '[]',
        accumulatedSubfacetCount: preSubfacets.length,
        consolidatedSubfacetsSnapshot: [],
      } as any);

      await node.processLlmResponse(llmOutput as any, undefined, tracker);

      expect(
        mockEntitySummaryService.createSummaryWithSubfacets,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'task-001',
          subfacets: ['CLI Architecture'],
        }),
      );
    });

    it('calls deprecated cleanup after deprecation step', async () => {
      mockSubfacetService.listByStatusAndCategory.mockResolvedValue(
        preSubfacets,
      );
      mockEntitySummaryService.getCurrentSummariesForSubfacetNames.mockResolvedValue(
        [],
      );

      const tracker = createMutableContextHandle<FlowContext>({
        ...baseContext,
        consolidationCategory: 'technology' as SummaryCategory,
        consolidationSince: '2026-01-01T00:00:00Z',
        consolidationThreshold: 24,
        accumulatedSubfacetsJson: '[]',
        accumulatedSubfacetCount: preSubfacets.length,
        consolidatedSubfacetsSnapshot: [],
      } as any);

      await node.processLlmResponse(llmOutput as any, undefined, tracker);

      expect(
        mockEntitySummaryService.removeDeprecatedSubfacetsFromCurrentSummaries,
      ).toHaveBeenCalledWith({
        organizationId,
        projectId: baseContext.core.projectId,
        category: 'technology',
      });

      // Verify both were called (ordering is enforced by the await chain in source)
      expect(
        mockSubfacetService.deprecateSubfacetsWithMetadata,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockEntitySummaryService.removeDeprecatedSubfacetsFromCurrentSummaries,
      ).toHaveBeenCalledTimes(1);
    });

    it('net result: 25 post-consolidation subfacets (24 merged targets + 1 kept)', () => {
      const targetNames = new Set(llmOutput.mergedSubfacets.map((m) => m.name));
      const keptNames = new Set(llmOutput.keptSubfacets.map((k) => k.name));
      const allPostNames = new Set([...targetNames, ...keptNames]);

      expect(allPostNames.size).toBe(25);
      expect(targetNames.size).toBe(24);
      expect(keptNames.size).toBe(1);

      // Verify every pre-consolidation subfacet is accounted for
      const allMergedFrom = new Set(
        llmOutput.mergedSubfacets.flatMap((m) =>
          m.mergedFrom.map((f) => f.toLowerCase()),
        ),
      );
      const keptLower = new Set(
        llmOutput.keptSubfacets.map((k) => k.name.toLowerCase()),
      );
      for (const sf of preSubfacets) {
        const inMergedFrom = allMergedFrom.has(sf.name.toLowerCase());
        const inKept = keptLower.has(sf.name.toLowerCase());
        expect(inMergedFrom || inKept).toBe(true);
      }
    });
  });
});
