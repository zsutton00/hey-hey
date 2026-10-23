import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ENTITY_SUMMARIZATION_NODES } from 'src/flows/constants';
import {
  NodeType,
  NonInteractiveNodeBase,
  PromptConfig,
  FlowContext,
  IntermediateSystemMessageData,
  FlowUserMessage,
  MutableContextHandle,
} from 'src/types/flow-internal.types';
import { StandardPlaceholderRegistry } from 'src/services/llm/placeholders/registries/standard-placeholders.registry';
import { EntityType, SubfacetStatus, SummaryCategory } from '@prisma/client';
import { entityClassificationSchema } from 'src/flows/utils/shared-schemas';
import { z } from 'zod';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { workflowAboutTypeToEntityType } from 'src/utils/workflow-about-type.util';
import { LLMProviderName, SyntheticModel } from 'src/services/llm/llm-shared';
import { SystemMessageData } from 'src/generated';
import { PlanId } from 'src/types';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { SubfacetLifecycleService } from 'src/services/entity-summary/subfacet-lifecycle.service';
import {
  ACTIVE_CAP_PER_CATEGORY,
  buildSummarizationPoolMode,
} from 'src/services/entity-summary/subfacet-lifecycle.policy';

type EntityClassification = z.infer<typeof entityClassificationSchema>;
type EntitySummarizationContext = FlowContext & {
  existingSubfacetCandidates?: Array<{
    id: string;
    name: string;
    category: SummaryCategory;
    status: SubfacetStatus;
  }>;
  subfacetCountsByCategory?: Record<
    SummaryCategory,
    { activeCount: number; provisionalCount: number }
  >;
  bootstrapDirectCreatesByCategory?: Record<SummaryCategory, number>;
};

@Injectable()
export class SummarizeNode extends NonInteractiveNodeBase {
  readonly id = ENTITY_SUMMARIZATION_NODES.SUMMARIZE;
  readonly type = NodeType.NON_INTERACTIVE;
  private readonly logger = new Logger(SummarizeNode.name);

  readonly promptConfig: PromptConfig = {
    systemPromptTemplate: (context: FlowContext) => {
      const entityType = workflowAboutTypeToEntityType(
        context.core.workflowAboutType,
      );

      let entityPlaceholder = '';
      let hasAcceptanceCriteria = false;
      if (entityType === EntityType.TASK) {
        entityPlaceholder = StandardPlaceholderRegistry.TASK.insert({
          name: true,
          status: false,
          priority: false,
          assignee: false,
          dueDate: false,
          description: true,
          details: false,
          acceptanceCriteria: true,
        });
        hasAcceptanceCriteria = true;
      } else if (entityType === EntityType.INITIATIVE) {
        entityPlaceholder =
          StandardPlaceholderRegistry.INITIATIVE_STRICT.insert();
        hasAcceptanceCriteria = true;
      } else if (entityType === EntityType.DESIGN_DOC) {
        entityPlaceholder = StandardPlaceholderRegistry.DESIGN_DOC.insert();
      } else {
        throw new Error(`Unsupported summary entity type: ${entityType}`);
      }

      const sections: string[] = [];

      sections.push(
        `You are generating compressed entity summaries for a hierarchical knowledge graph 
  used in RAG pipelines. These summaries serve three purposes:
  
  1. ROLL-UP AGGREGATION: Multiple entities will be grouped under subfacets 
     (e.g., "agent capabilities", "ui components"). Use consistent terminology 
     so subfacet-level summaries can synthesize cleanly.
  
  2. EMBEDDING SEARCH: Front-load discriminative keywords (technologies, outcomes, 
     domain concepts). Avoid fluffy phrases like "this involves" or "the team decided."
  
  3. PROMPT INJECTION: Assume the reader has system-wide context. Focus on what makes THIS entity distinct, not general system architecture.
  
  Optimize for semantic search retrieval. Use consistent terminology across similar entities. 
  Front-load discriminative keywords that distinguish this entity from others.`,
      );

      sections.push(`AVAILABLE ENTITY CONTEXT:
${entityPlaceholder}

HIERARCHICAL SYNTHESIS APPROACH:
Step 1: Classify the entity into category + subfacets based on what it accomplishes
Step 2: Write the summary to explain HOW this entity fits those subfacets

STRICT GROUNDING:
- Do not add details that are not explicitly present in the entity context.
- If a detail is missing, omit it rather than inferring.

Do NOT:
- Copy phrases from description, even partially
- Include design rationale ("trade-offs", "approach", "decoupling", "leverages")
- Restate implementation timing ("at serialization time", "during startup")

DO:
- State capabilities and outcomes in your own words
- Use canonical terms that will group with similar entities
- Write for embedding search: front-load discriminative keywords

Target 60 words of factual statements optimized for aggregation.`);

      sections.push(`OUTPUT CONTRACT (valid JSON):
STEP 1 - CLASSIFY FIRST:
- category: exactly one of "technology", "product", "process", "people"
  * What domain does this entity operate in?

${SummarizeNode.buildSubfacetCandidateInstructions(
  context as EntitySummarizationContext,
)}

STEP 2 - WRITE SUMMARY TO FIT THE SUBFACETS:
- summary: 60 words explaining how this entity serves selectedExistingSubfacetNames (or proposedNewSubfacetName if used)
- What specific thing does this do? (parsing, migrating, validating)
- Where does it integrate? (which systems/components)
- What technologies are involved? (2-4 specific names)
- What does it enable or unblock?

Optimize for keyword density - every noun and verb should help retrieval.
Avoid describing the same mechanism twice at different abstraction levels.
All summary statements must be supported by the entity context above.
`);

      sections.push(`VOCABULARY CONSTRAINTS:
- Use technology names exactly as they appear in the entity (React, PostgreSQL, not "the frontend framework")
- Prefer domain terms from the entity's category/subfacets
- If multiple entities share a theme (e.g., "authentication"), use identical phrasing across summaries
- Avoid: "this task", "the implementation", "we chose", "trade-off", "approach"
- Favor: action verbs (parsed, migrated, validated) + concrete nouns (mentions, schema, metrics)`);

      sections.push(`LENGTH & ABSTRACTION:
- Keep summaries under 60 words, avoid step-by-step instructions.
- Stay at the entity level: synthesize themes; don't restate raw bullets.
- Do not invent timelines, metrics, owners, or decisions not present in sources.`);

      if (hasAcceptanceCriteria) {
        sections.push(`ACCEPTANCE CRITERIA INTERPRETATION:

Parse acceptance criteria into categories:
1. CAPABILITIES: What can users/systems do after this is complete?
2. TECHNICAL CHANGES: What components/tables/APIs are modified?
3. PROCESS REQUIREMENTS: Testing, validation, coverage requirements

Summarize CAPABILITIES and TECHNICAL CHANGES only. 
Process requirements are implicit - don't waste tokens on "validates", "tested", or "correctly propagated".
Acceptance criteria are only for higher-level category signals (capabilities/tech changes), not QA/coverage or perf targets.
Exclude performance/aspirational goals like response times (ms/s/min), latency/throughput/QPS/RPS, percentiles (p50/p90/p95/p99), SLAs/SLOs, uptime/availability, or error-rate targets.

Example filtering:
Input: "Mentions are correctly propagated in at least one end-to-end test scenario"
Category: PROCESS REQUIREMENT → Exclude from summary
Reasoning: This describes testing obligation, not capability or technical change`);
      }

      sections.push(`KNOWN FAILURE MODES + MITIGATIONS:
- Hallucinated decisions or dates → explicitly mark unknown instead of assuming.
- Category drift → re-check allowed categories before output.
- Excessive subfacets → limit to the top 1-3 high-signal themes.
- Generic next steps → anchor in actual outcomes or blockers from the entity.`);

      sections.push(`WORKED EXAMPLES (abbreviated):
Example 1:
{
  "category": "technology",
  "subfacets": ["database migration", "schema evolution"],
  "summary": "PostgreSQL schema migration adds conversation_id foreign key to message_mention table, enables conversation-scoped mention queries. Migration script handles existing data backfill, preserves mention integrity constraints. Unblocks conversation-context features requiring isolated mention resolution."
}

Example 2:
{
  "category": "product",
  "subfacets": ["interaction design", "visual feedback"],
  "summary": "Loading states for AI responses replace static spinners with streaming indicators showing token generation progress. Improves perceived responsiveness during long-running LLM calls. Implemented via React Suspense boundaries with progress estimation from token streaming API."
}`);

      sections.push(`ANTI-PATTERN EXAMPLE:
❌ Status language: "backlog task", "awaiting implementation", "in progress"
✅ Capability language: "enables", "unblocks", "supports"

❌ Requirements: "requires placeholder registry implementation"  
✅ Dependencies: "depends on StandardPlaceholderRegistry.CONVERSATION_MENTIONS"

❌ Implementation details: "at serialization time"
✅ System behavior: "injects mentions during message payload construction"

When you catch yourself using phrases like "pattern", "approach", "trading X for Y", 
"at [time] time"—STOP. Restate the capability from scratch.`);

      sections.push('Return only the JSON object with all required fields.');

      return sections.join('\n\n');
    },
    responseSchema: entityClassificationSchema,
    temperature: 0.2,
    modelCriteria: {
      model: SyntheticModel.GLM_4_7_FLASH,
      provider: LLMProviderName.SYNTHETIC,
    },
    timeout: 120000,
  };

  constructor(
    private readonly entitySummaryService: EntitySummaryService,
    private readonly initiativeService: InitiativeService,
    private readonly taskService: TaskService,
    private readonly designDocService: DesignDocService,
    private readonly subfacetService: SubfacetService,
    private readonly subfacetLifecycleService: SubfacetLifecycleService,
  ) {
    super();
  }

  private skipMissingEntity(
    entityType: string,
    entityId: string,
    organizationId: string,
  ): { run: false; reason: string } {
    const reason = `[SummarizeNode] ${entityType} not found for summary (entityId: ${entityId}, organizationId: ${organizationId})`;
    this.logger.warn(reason);
    return {
      run: false,
      reason,
    };
  }

  async beforeGeneration(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<void> {
    const context = tracker.getContext();
    if (!context.core.projectId) {
      throw new Error(
        '[SummarizeNode] Missing projectId for subfacet candidate loading',
      );
    }

    const allNonDeprecatedSubfacets = await this.subfacetService.listSubfacets({
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      orderByUpdatedAtDesc: true,
      take: 500,
    });

    const categories: SummaryCategory[] = [
      SummaryCategory.technology,
      SummaryCategory.product,
      SummaryCategory.process,
      SummaryCategory.people,
    ];
    const candidates: Array<{
      id: string;
      name: string;
      category: SummaryCategory;
      status: SubfacetStatus;
    }> = [];
    const subfacetCountsByCategory: Record<
      SummaryCategory,
      { activeCount: number; provisionalCount: number }
    > = {
      [SummaryCategory.technology]: { activeCount: 0, provisionalCount: 0 },
      [SummaryCategory.product]: { activeCount: 0, provisionalCount: 0 },
      [SummaryCategory.process]: { activeCount: 0, provisionalCount: 0 },
      [SummaryCategory.people]: { activeCount: 0, provisionalCount: 0 },
    };

    for (const category of categories) {
      const categorySubfacets = allNonDeprecatedSubfacets.filter(
        (subfacet) =>
          subfacet.category === category &&
          subfacet.status !== SubfacetStatus.DEPRECATED,
      );
      const active = categorySubfacets.filter(
        (subfacet) => subfacet.status === SubfacetStatus.ACTIVE,
      );
      const provisional = categorySubfacets.filter(
        (subfacet) => subfacet.status === SubfacetStatus.PROVISIONAL,
      );

      subfacetCountsByCategory[category] = {
        activeCount: active.length,
        provisionalCount: provisional.length,
      };

      const mode = buildSummarizationPoolMode(active.length);
      const pool =
        mode === 'active_only'
          ? active.slice(0, ACTIVE_CAP_PER_CATEGORY)
          : mode === 'active_with_provisional_fill'
            ? [
                ...active,
                ...provisional.slice(
                  0,
                  Math.max(ACTIVE_CAP_PER_CATEGORY - active.length, 0),
                ),
              ]
            : provisional.slice(0, ACTIVE_CAP_PER_CATEGORY);

      candidates.push(
        ...pool.map((subfacet) => ({
          id: subfacet.id,
          name: subfacet.name,
          category: subfacet.category,
          status: subfacet.status,
        })),
      );
    }

    tracker.mutate((draft) => {
      const typedDraft = draft as EntitySummarizationContext;
      typedDraft.existingSubfacetCandidates = candidates;
      typedDraft.subfacetCountsByCategory = subfacetCountsByCategory;
      typedDraft.bootstrapDirectCreatesByCategory = {
        [SummaryCategory.technology]: 0,
        [SummaryCategory.product]: 0,
        [SummaryCategory.process]: 0,
        [SummaryCategory.people]: 0,
      };
    });

    this.logger.debug(
      '[beforeGeneration] loaded existing subfacet candidates',
      {
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        candidateCount: candidates.length,
        countsByCategory: subfacetCountsByCategory,
      },
    );
  }

  async shouldRun(
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ run: boolean; reason?: string }> {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;
    const entityType = workflowAboutTypeToEntityType(workflowAboutType);

    if (!entityType || !workflowAboutId) {
      throw new Error(
        `[SummarizeNode] Missing entity identifiers for summary (entityType: ${workflowAboutType}, entityId: ${workflowAboutId})`,
      );
    }

    if (entityType === EntityType.TASK) {
      const task = await this.taskService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      if (!task) {
        return this.skipMissingEntity('Task', workflowAboutId, organizationId);
      }
      return { run: true };
    }

    if (entityType === EntityType.INITIATIVE) {
      const initiative = await this.initiativeService.findOne(
        workflowAboutId,
        organizationId,
      );
      if (!initiative) {
        return this.skipMissingEntity(
          'Initiative',
          workflowAboutId,
          organizationId,
        );
      }
      tracker.mutate((draft) => {
        (draft as FlowContext & { initiativeId?: string }).initiativeId =
          workflowAboutId;
      });
      return { run: true };
    }

    if (entityType === EntityType.DESIGN_DOC) {
      const designDoc = await this.designDocService.findOneForAdapter(
        workflowAboutId,
        organizationId,
      );
      if (!designDoc) {
        return this.skipMissingEntity(
          'Design doc',
          workflowAboutId,
          organizationId,
        );
      }
      return { run: true };
    }

    if (entityType === EntityType.MESSAGE) {
      return {
        run: false,
        reason: '[SummarizeNode] Message entity summarization is disabled',
      };
    }

    throw new Error(
      `[SummarizeNode] Unsupported entity type for summary (entityType: ${workflowAboutType})`,
    );
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<{ modifiedResult?: SystemMessageData }> {
    const context = tracker.getContext();
    const { workflowAboutId, workflowAboutType, organizationId, projectId } =
      context.core;
    const entityType = workflowAboutTypeToEntityType(workflowAboutType);

    if (!entityType || !workflowAboutId) {
      throw new Error(
        `[SummarizeNode] Missing entity identifiers for summary (entityType: ${workflowAboutType}, entityId: ${workflowAboutId})`,
      );
    }

    if (!projectId) {
      throw new Error('[SummarizeNode] Missing projectId for summary creation');
    }

    const raw = systemMessageData as Record<string, unknown>;
    const cleanedSummary =
      typeof raw.summary === 'string' ? raw.summary.trim() : '';
    if (!cleanedSummary) {
      throw new Error('[SummarizeNode] Missing summary from LLM response');
    }
    const cleanedSubfacets = Array.from(
      new Set(
        Array.isArray(raw.subfacets)
          ? raw.subfacets
              .map((facet) =>
                typeof facet === 'string' ? facet.trim() : String(facet || ''),
              )
              .filter(Boolean)
          : [],
      ),
    ).slice(0, 3);
    const cleanedSelectedExistingSubfacetNames = Array.from(
      new Set(
        Array.isArray(raw.selectedExistingSubfacetNames)
          ? raw.selectedExistingSubfacetNames
              .map((name) => (typeof name === 'string' ? name.trim() : ''))
              .filter(Boolean)
          : [],
      ),
    ).slice(0, 3);
    const cleanedProposedNewSubfacetName =
      typeof raw.proposedNewSubfacetName === 'string'
        ? raw.proposedNewSubfacetName.trim() || null
        : null;
    const cleanedProposedNewSubfacetRationale =
      typeof raw.proposedNewSubfacetRationale === 'string'
        ? raw.proposedNewSubfacetRationale.trim() || null
        : null;
    const cleanedProposedNewSubfacetConfidence =
      typeof raw.proposedNewSubfacetConfidence === 'number'
        ? raw.proposedNewSubfacetConfidence
        : null;

    const normalizedPayload: EntityClassification = {
      summary: cleanedSummary,
      category:
        typeof raw.category === 'string'
          ? (raw.category
              .trim()
              .toLowerCase() as EntityClassification['category'])
          : ('' as EntityClassification['category']),
      selectedExistingSubfacetNames: cleanedSelectedExistingSubfacetNames,
      proposedNewSubfacetName: cleanedProposedNewSubfacetName,
      proposedNewSubfacetRationale: cleanedProposedNewSubfacetRationale,
      proposedNewSubfacetConfidence: cleanedProposedNewSubfacetConfidence,
      subfacets: cleanedSubfacets,
    };

    const parseResult = entityClassificationSchema.safeParse(normalizedPayload);

    if (!parseResult.success) {
      throw new Error(
        `Invalid entity summary response: ${parseResult.error.message}`,
      );
    }

    const existingCandidates =
      (context as EntitySummarizationContext).existingSubfacetCandidates ?? [];
    const subfacetCountsByCategory = (context as EntitySummarizationContext)
      .subfacetCountsByCategory;
    const bootstrapDirectCreatesByCategory = (
      context as EntitySummarizationContext
    ).bootstrapDirectCreatesByCategory;
    const categoryCandidates = existingCandidates.filter(
      (candidate) => candidate.category === parseResult.data.category,
    );
    const existingByNormalizedName = new Map(
      categoryCandidates.map((candidate) => [
        SummarizeNode.normalizeSubfacetName(candidate.name),
        candidate.name,
      ]),
    );

    const resolveNames = (names: string[]): string[] =>
      names
        .map((name) =>
          existingByNormalizedName.get(
            SummarizeNode.normalizeSubfacetName(name),
          ),
        )
        .filter((name): name is string => !!name);

    const primaryMatches = resolveNames(
      parseResult.data.selectedExistingSubfacetNames || [],
    );
    const fallbackMatches = resolveNames(parseResult.data.subfacets || []);

    const selectedSubfacetNames =
      primaryMatches.length > 0 || fallbackMatches.length > 0
        ? Array.from(new Set([...primaryMatches, ...fallbackMatches])).slice(
            0,
            3,
          )
        : [];

    if (parseResult.data.proposedNewSubfacetName) {
      const currentCounts =
        subfacetCountsByCategory?.[parseResult.data.category];
      const directCreatesForCategory =
        bootstrapDirectCreatesByCategory?.[parseResult.data.category] ?? 0;
      const nextCounts = currentCounts ?? {
        activeCount: 0,
        provisionalCount: 0,
      };
      const decision =
        await this.subfacetLifecycleService.handleProposedSubfacet({
          organizationId,
          projectId,
          category: parseResult.data.category,
          proposedNewSubfacetName: parseResult.data.proposedNewSubfacetName,
          proposedNewSubfacetConfidence:
            parseResult.data.proposedNewSubfacetConfidence ?? undefined,
          proposedNewSubfacetRationale:
            parseResult.data.proposedNewSubfacetRationale ?? undefined,
          sourceEntityType: entityType,
          sourceEntityId: workflowAboutId,
          activeCount: nextCounts.activeCount,
          provisionalCount: nextCounts.provisionalCount,
          directCreatesThisRunForCategory: directCreatesForCategory,
        });
      if (
        decision.selectedSubfacetName &&
        !selectedSubfacetNames.includes(decision.selectedSubfacetName)
      ) {
        selectedSubfacetNames.push(decision.selectedSubfacetName);
      }
      tracker.mutate((draft) => {
        const typedDraft = draft as EntitySummarizationContext;
        const nextBootstrapCounts = {
          ...(typedDraft.bootstrapDirectCreatesByCategory ?? {
            [SummaryCategory.technology]: 0,
            [SummaryCategory.product]: 0,
            [SummaryCategory.process]: 0,
            [SummaryCategory.people]: 0,
          }),
        };
        nextBootstrapCounts[parseResult.data.category] =
          decision.directCreatesThisRunForCategory;
        typedDraft.bootstrapDirectCreatesByCategory = nextBootstrapCounts;

        const nextCategoryCounts = {
          ...(typedDraft.subfacetCountsByCategory ?? {
            [SummaryCategory.technology]: {
              activeCount: 0,
              provisionalCount: 0,
            },
            [SummaryCategory.product]: {
              activeCount: 0,
              provisionalCount: 0,
            },
            [SummaryCategory.process]: {
              activeCount: 0,
              provisionalCount: 0,
            },
            [SummaryCategory.people]: { activeCount: 0, provisionalCount: 0 },
          }),
        };
        nextCategoryCounts[parseResult.data.category] = {
          activeCount: decision.activeCount,
          provisionalCount: decision.provisionalCount,
        };
        typedDraft.subfacetCountsByCategory = nextCategoryCounts;
      });
    }

    const saved = await this.entitySummaryService.createSummaryWithSubfacets({
      entityType,
      entityId: workflowAboutId,
      organizationId,
      projectId,
      summary: parseResult.data.summary,
      category: parseResult.data.category as SummaryCategory,
      subfacets: selectedSubfacetNames.slice(0, 3),
    });

    const persistedSubfacets = (saved.subfacets || []).map((sf) => sf.name);

    this.logger.log(
      `[processLlmResponse] saved entity summary entityType=${entityType} entityId=${workflowAboutId} category=${saved.summary.category} subfacets=${persistedSubfacets.join(
        ', ',
      )} summaryId=${saved.summary.id}`,
    );

    return {
      modifiedResult: {
        ...parseResult.data,
        category: saved.summary.category,
        subfacets: persistedSubfacets,
        selectedExistingSubfacetNames: selectedSubfacetNames,
        proposedNewSubfacetName: parseResult.data.proposedNewSubfacetName,
        proposedNewSubfacetRationale:
          parseResult.data.proposedNewSubfacetRationale,
        proposedNewSubfacetConfidence:
          parseResult.data.proposedNewSubfacetConfidence,
        summaryId: saved.summary.id,
        entityId: workflowAboutId,
        entityType,
      } as unknown as SystemMessageData,
    };
  }

  private static buildSubfacetCandidateInstructions(
    context: EntitySummarizationContext,
  ): string {
    const candidatesByCategory = new Map<SummaryCategory, string[]>();
    for (const category of [
      'technology',
      'product',
      'process',
      'people',
    ] as const) {
      candidatesByCategory.set(category, []);
    }

    for (const candidate of context.existingSubfacetCandidates || []) {
      const list = candidatesByCategory.get(candidate.category);
      if (list) {
        list.push(candidate.name);
      }
    }

    const candidateLines: string[] = [];
    for (const category of [
      'technology',
      'product',
      'process',
      'people',
    ] as const) {
      candidateLines.push(`- ${category}:`);
      const names = candidatesByCategory.get(category) || [];
      if (!names.length) {
        candidateLines.push('  - (none)');
        continue;
      }
      for (const name of names) {
        candidateLines.push(`  - ${name}`);
      }
    }

    return `- selectedExistingSubfacetNames: choose 0-3 names from the EXISTING SUBFACET CANDIDATES for the chosen category.
- proposedNewSubfacetName: optional, max 1. Use only when none of the existing names fit. Return null when unused.
- proposedNewSubfacetConfidence: optional 0-1 confidence for proposedNewSubfacetName. Return null when unused.
- proposedNewSubfacetRationale: optional one-sentence reason for proposing a new subfacet. Return null when unused.
- subfacets: fallback list of names (0-3) if name-based selection is not possible.

EXISTING SUBFACET CANDIDATES (by category):
${candidateLines.join('\n')}`;
  }

  private static normalizeSubfacetName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[_-]/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
  }
}
