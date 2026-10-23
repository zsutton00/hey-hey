import { Logger } from '@nestjs/common';
import { ArtifactType, EntityType, SummaryCategory } from '@prisma/client';
import {
  ArtifactResponseDto,
  InitiativeResponseDto,
  QAPairData,
  TaskResponseDto,
} from 'src/generated';
import { DesignDocLinkResponseDto } from 'src/generated/model/designDocLinkResponseDto';
import type {
  ConversationId,
  DesignDocId,
  PlanId,
  TaskId,
} from '../../../../types';
import { getCurrentSectionFromStatus } from '../../../../types/design-doc.types';
import type {
  FlowContext,
  TaskGenerationFlowContext,
} from '../../../../types/flow-internal.types';
import type { TaskStubSessionState } from '../../../../types/task-generation.types';
import {
  artifactTypeToFriendlyType,
  extractArtifactContent,
  formatArtifactsForPrompt,
  reconstructConversationFromQaPairs,
} from '../../../../utils/artifact-formatting.util';
import { errorToLoggable } from '../../../../utils/logging.util';
import { formatMention } from '../../../../utils/mentionFormatting';
import { MessageContentExtractor } from '../../../../utils/message-content-extractor';
import { materializedSectionsToContentMap } from '../../../../utils/work-item-section.util';
import { PlaceholderContextUtils } from '../base/placeholder-context';
import { PlaceholderDefinition } from '../base/placeholder-definition';
import { PlaceholderRegistry } from '../base/placeholder-registry';
import type { PlaceholderContext } from '../base/placeholder-types';
import {
  formatContextSearchResults,
  getContextSearchResults,
} from '../utils/context-search.utils';
import { getEndingDelimiter, getStartingDelimiter } from '../utils/delimiters';
import { maturityGuidanceMap } from './constants';

const getInitiativeSectionContent = (
  initiative?: InitiativeResponseDto | null,
) => materializedSectionsToContentMap(initiative?.sections);

// Node context data structure
interface NodeContextData {
  id: string;
  type: string;
  title?: string;
}

interface DesignDocSectionLike {
  key?: string | null;
  content?: string | null;
}

interface DesignDocSearchSource {
  name?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  sections?: DesignDocSectionLike[] | null;
}

function formatTaskStubGroup(
  label: string,
  stubs: TaskStubSessionState['stubs'],
): string | undefined {
  if (!stubs.length) {
    return undefined;
  }

  const lines = stubs.map((stub, index) => {
    return `${index + 1}. ${stub.title} — ${stub.shortDescription}`;
  });

  return `${label}:\n${lines.join('\n')}`;
}

const MAX_DESIGN_DOC_SEARCH_QUERIES = 4;
const MAX_DESIGN_DOC_QUERY_LENGTH = 400;
const DESIGN_DOC_SECTION_PRIORITY = [
  'context',
  'problem',
  'motivation',
  'drivers',
  'decision',
  'solution',
  'consequences',
  'statusnotes',
  'status_notes',
  'status',
];

const designDocContextSearchLogger = new Logger(
  'DesignDocContextSearchPlaceholder',
);

function extractDesignDocSearchQueries(
  designDoc: DesignDocSearchSource,
): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown): void => {
    if (queries.length >= MAX_DESIGN_DOC_SEARCH_QUERIES) {
      return;
    }

    const normalized = normalizeDesignDocSearchValue(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    queries.push(normalized);
  };

  push(designDoc.summary);

  if (Array.isArray(designDoc.sections)) {
    for (const key of DESIGN_DOC_SECTION_PRIORITY) {
      const matchingSection = designDoc.sections.find((section) => {
        const sectionKey =
          typeof section?.key === 'string'
            ? section.key.trim().toLowerCase()
            : '';
        return sectionKey === key;
      });

      if (matchingSection) {
        push(matchingSection.content);
      }

      if (queries.length >= MAX_DESIGN_DOC_SEARCH_QUERIES) {
        break;
      }
    }

    if (queries.length < MAX_DESIGN_DOC_SEARCH_QUERIES) {
      for (const section of designDoc.sections) {
        if (queries.length >= MAX_DESIGN_DOC_SEARCH_QUERIES) {
          break;
        }

        if (!section) {
          continue;
        }

        const sectionKey =
          typeof section.key === 'string'
            ? section.key.trim().toLowerCase()
            : '';

        if (DESIGN_DOC_SECTION_PRIORITY.includes(sectionKey)) {
          continue;
        }

        push(section.content);
      }
    }
  }

  push(designDoc.name);

  if (
    queries.length < MAX_DESIGN_DOC_SEARCH_QUERIES &&
    Array.isArray(designDoc.tags) &&
    designDoc.tags.length > 0
  ) {
    push(designDoc.tags.join(', '));
  }

  return queries;
}

function normalizeDesignDocSearchValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const collapsed = trimmed.replace(/\s+/g, ' ');
  if (!collapsed) {
    return undefined;
  }

  if (collapsed.length > MAX_DESIGN_DOC_QUERY_LENGTH) {
    return collapsed.slice(0, MAX_DESIGN_DOC_QUERY_LENGTH);
  }

  return collapsed;
}

function formatDesignDocSearchLabel(
  designDoc: DesignDocSearchSource,
  designDocId: DesignDocId,
): string {
  const name = normalizeDisplayText(designDoc.name);
  if (name) {
    return truncateForDisplay(name);
  }

  const summary = normalizeDisplayText(designDoc.summary);
  if (summary) {
    return truncateForDisplay(summary);
  }

  return `Design Doc ${String(designDocId)}`;
}

function normalizeDisplayText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateForDisplay(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function wrapWithDelimiters(type: string, content: string): string {
  const normalizedContent = content.trim();
  return `${getStartingDelimiter(type)}\n${normalizedContent}\n${getEndingDelimiter(type)}`;
}

function normalizeMentionType(entityType: EntityType): string {
  return String(entityType).toLowerCase().replace(/_/g, '-');
}

/**
 * Standard placeholder registry containing common placeholders used across all flows
 */
export class StandardPlaceholderRegistry extends PlaceholderRegistry {
  private readonly logger = new Logger(StandardPlaceholderRegistry.name);

  // ===================
  // Static Placeholder Definitions
  // ===================

  // Simple Value Placeholders - IDs and Context
  static readonly WORKFLOW_ID = PlaceholderDefinition.create(
    'workflowId',
    'Current workflow ID',
    (ctx) => String(ctx.flowContext.core.workflowId),
  );

  static readonly ORGANIZATION_ID = PlaceholderDefinition.create(
    'organizationId',
    'Organization ID',
    (ctx) => String(ctx.flowContext.core.organizationId),
  );

  static readonly PROJECT_ID = PlaceholderDefinition.create(
    'projectId',
    'Project ID',
    (ctx) => String(ctx.flowContext.core.projectId),
  );

  static readonly CONVERSATION_ID = PlaceholderDefinition.create(
    'conversationId',
    'Conversation ID',
    (ctx) => String(ctx.flowContext.core.conversationId),
  );

  static readonly INTERACTION_COUNT = PlaceholderDefinition.createNumber(
    'interactionCount',
    'Session interaction count',
    (ctx) => ctx.flowContext.core.session?.interactionCount || 0,
  );

  // Current Message Placeholders
  static readonly CURRENT_MESSAGE = PlaceholderDefinition.create(
    'currentMessage',
    'Current user message content',
    (ctx) => PlaceholderContextUtils.getUserMessageContent(ctx),
  );

  static readonly MESSAGE = PlaceholderDefinition.create(
    'message',
    'Workflow message content',
    async (ctx) => {
      const messageId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
        ctx,
        'message',
      );

      if (!messageId) {
        return '';
      }

      const messageService = ctx.services.messageService;
      if (!messageService?.getMessage) {
        throw new Error('Message service unavailable for message placeholder');
      }

      const message = await messageService.getMessage(
        messageId,
        ctx.flowContext.core.organizationId,
        true,
      );

      if (!message) {
        throw new Error(`Message not found for summary (${messageId})`);
      }

      const content = MessageContentExtractor.extractMessageContent(message);
      if (!content) {
        throw new Error(`Message content missing for summary (${messageId})`);
      }

      return `Message content:\n${content}`;
    },
  );

  // Initiative Simple Fields
  static readonly INITIATIVE_NAME = PlaceholderDefinition.create(
    'initiative.name',
    'Initiative name',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      return initiative?.name || '';
    },
  );

  static readonly INITIATIVE_DESCRIPTION = PlaceholderDefinition.create(
    'initiative.description',
    'Initiative description',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      const content = getInitiativeSectionContent(initiative);
      return content.description || '';
    },
  );

  static readonly INITIATIVE_PRIORITY = PlaceholderDefinition.create(
    'initiative.priority',
    'Initiative priority',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      return initiative?.priority || '';
    },
  );

  static readonly INITIATIVE_TAGS = PlaceholderDefinition.create(
    'initiative.tags',
    'Initiative tags',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      return initiative?.tags?.join(', ') || '';
    },
  );

  static readonly INITIATIVE_CURRENT_LEVEL = PlaceholderDefinition.create(
    'initiative.currentLevel',
    'Current refinement level',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      return StandardPlaceholderRegistry.prototype.mapInitiativeStatusToLevel(
        initiative?.status,
      ).level;
    },
  );

  // Database Entity Fields ($ prefix)
  static readonly INITIATIVE_REASONING = PlaceholderDefinition.create(
    '$initiative.reasoning',
    'Initiative reasoning from DB',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;
      return initiative?.reasoning || '';
    },
  );

  // ===================
  // Strict Database Placeholder Variants
  // ===================

  // Task/Project Fields - from workflowAboutId/Type
  static readonly TASK = PlaceholderDefinition.create(
    'task',
    'Task data',
    async (
      ctx,
      options?: {
        name?: boolean;
        status?: boolean;
        priority?: boolean;
        assignee?: boolean;
        dueDate?: boolean;
        description?: boolean;
        details?: boolean;
        acceptanceCriteria?: boolean;
      },
    ) => {
      // Get task ID if the workflow is about a task
      const taskId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
        ctx,
        'task',
      ) as TaskId | undefined;

      if (!taskId) {
        return '';
      }

      try {
        // Load the task using the task service
        const task = await ctx.services.taskService.findOneForAdapter(
          taskId as string,
          ctx.flowContext.core.organizationId,
        );

        if (!task) {
          return '';
        }

        // Return formatted task data
        return StandardPlaceholderRegistry.prototype.formatTaskForStandard(
          task,
          options ? { include: options } : undefined,
        );
      } catch (error) {
        return '';
      }
    },
  );

  static readonly DESIGN_DOC = PlaceholderDefinition.create(
    'designDoc',
    'Design Document data',
    async (ctx) => {
      const flowContext = ctx.flowContext as Partial<TaskGenerationFlowContext>;
      const designDocId =
        (PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
          ctx,
          'design-doc',
        ) as DesignDocId | undefined) ||
        (flowContext.designDocId as DesignDocId | undefined);

      if (!designDocId) {
        return '';
      }

      try {
        // Load the design doc using the design doc service
        const designDoc = await ctx.services.designDocService.findOneForAdapter(
          designDocId as string,
          ctx.flowContext.core.organizationId,
        );

        if (!designDoc) {
          return '';
        }

        const sectionsByKey = (designDoc.sections ?? []).reduce(
          (acc, s) => ({ ...acc, [s.key]: s.materializedMarkdown }),
          {},
        ) as Record<string, string>;

        const addIfDefined = (header: string, content: string | undefined) => {
          if (!content) return '';
          return `#### ${header}\n${content}`;
        };

        const out = [
          addIfDefined('Title', designDoc.name),
          addIfDefined('Summary', designDoc.summary),
          addIfDefined('Context', sectionsByKey['context'] || '[empty]'),
          addIfDefined('Decision', sectionsByKey['decision'] || '[empty]'),
          addIfDefined(
            'Consequences',
            sectionsByKey['consequences'] || '[empty]',
          ),
        ]
          .filter(Boolean)
          .join('\n');
        return wrapWithDelimiters('DESIGN_DOC', out);
      } catch (error) {
        return '';
      }
    },
  );

  static readonly DESIGN_DOC_SUMMARY = PlaceholderDefinition.create(
    'designDocSummary',
    'Design Document summary field',
    async (ctx) => {
      const designDocId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
        ctx,
        'design-doc',
      ) as DesignDocId | undefined;

      if (!designDocId) {
        return '';
      }

      try {
        const designDoc = await ctx.services.designDocService.findOneForAdapter(
          designDocId as string,
          ctx.flowContext.core.organizationId,
        );

        if (!designDoc) {
          throw new Error('');
        }

        if (!designDoc.summary || designDoc.summary.trim().length === 0) {
          return '';
        }

        return designDoc.summary;
      } catch (error) {
        return '';
      }
    },
  );

  // Task-specific level-aware placeholders
  static readonly TASK_LEVEL_CLASSIFICATION_RULES =
    PlaceholderDefinition.create(
      'taskLevelClassificationRules',
      'Level-specific classification rules for current task',
      async (ctx) => {
        // Get task ID if the workflow is about a task
        const taskId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
          ctx,
          'task',
        ) as TaskId | undefined;

        if (!taskId) {
          return '';
        }

        try {
          // Load the task using the task service
          const task = await ctx.services.taskService.findOneForAdapter(
            taskId as string,
            ctx.flowContext.core.organizationId,
          );

          if (!task) {
            return '';
          }
          const currentLevel = getCurrentSectionFromStatus(task.status);

          // Return level-specific classification rules
          switch (currentLevel) {
            case 'description':
              return `**VALID REFINEMENT LEVELS (use these exact values):**
- "description" - Basic task definition, name, and scope
- "details" - Technical implementation details, dependencies, and approach
- "acceptanceCriteria" - Testing requirements and completion criteria

**For DESCRIPTION level (CURRENT LEVEL):**
- approve_level: User approves task description and wants to move to implementation details
- approve_with_edit: User approves but wants modifications applied first, then auto-approve
- edit_content: User wants to modify the task name, description, or basic scope
- general_response: General questions or comments not requiring specific action

**For FEEDBACK RESPONSES (available when feedback is present):**
- accept_feedback: User wants to accept suggested changes ("accept", "apply changes", "use suggestions", "that looks good")
- reject_feedback: User wants to reject suggested changes ("reject", "no thanks", "keep current", "don't change")`;

            case 'details':
              return `**VALID REFINEMENT LEVELS (use these exact values):**
- "description" - Basic task definition, name, and scope
- "details" - Technical implementation details, dependencies, and approach
- "acceptanceCriteria" - Testing requirements and completion criteria

**For DETAILS level (CURRENT LEVEL):**
- approve_level: User approves implementation details and wants to move to acceptance criteria
- approve_with_edit: User approves but wants modifications applied first, then auto-approve
- edit_content: User wants to modify technical approach, dependencies, or implementation details
- general_response: General questions or comments not requiring specific action

**For FEEDBACK RESPONSES (available when feedback is present):**
- accept_feedback: User wants to accept suggested changes ("accept", "apply changes", "use suggestions", "that looks good")
- reject_feedback: User wants to reject suggested changes ("reject", "no thanks", "keep current", "don't change")`;

            case 'acceptanceCriteria':
              return `**VALID REFINEMENT LEVELS (use these exact values):**
- "description" - Basic task definition, name, and scope
- "details" - Technical implementation details, dependencies, and approach
- "acceptanceCriteria" - Testing requirements and completion criteria

**For ACCEPTANCE_CRITERIA level (CURRENT LEVEL):**
- finalize: User approves acceptance criteria and task is ready for implementation
- edit_content: User wants to modify testing requirements or completion criteria
- general_response: General questions or comments not requiring specific action

**For FEEDBACK RESPONSES (available when feedback is present):**
- accept_feedback: User wants to accept suggested changes ("accept", "apply changes", "use suggestions", "that looks good")
- reject_feedback: User wants to reject suggested changes ("reject", "no thanks", "keep current", "don't change")`;

            default:
              return `**VALID REFINEMENT LEVELS (use these exact values):**
- "description" - Basic task definition, name, and scope
- "details" - Technical implementation details, dependencies, and approach
- "acceptanceCriteria" - Testing requirements and completion criteria

**Current level unknown - using general classification rules:**
- approve_level: User approves current content and wants to progress
- approve_with_edit: User approves but wants modifications applied first, then auto-approve
- edit_content: User wants to modify current content
- finalize: User approves final content (only if at acceptance criteria level)
- general_response: General questions or comments not requiring specific action`;
          }
        } catch (_error) {
          return '';
        }
      },
    );

  static readonly TASK_LEVEL_APPROVAL_PATTERNS = PlaceholderDefinition.create(
    'taskLevelApprovalPatterns',
    'Level-specific approval patterns for current task',
    async (ctx) => {
      // Get task ID if the workflow is about a task
      const taskId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
        ctx,
        'task',
      ) as TaskId | undefined;

      if (!taskId) {
        return '';
      }

      try {
        // Load the task using the task service
        const task = await ctx.services.taskService.findOneForAdapter(
          taskId as string,
          ctx.flowContext.core.organizationId,
        );

        if (!task) {
          return '';
        }

        const currentLevel = getCurrentSectionFromStatus(task.status);

        // Return level-specific approval patterns
        switch (currentLevel) {
          case 'description':
            return `**CRITICAL APPROVAL PATTERNS FOR DESCRIPTION LEVEL:**
- "good, let's move to details" = approve_level
- "let's move to implementation details" = approve_level
- "move forward" or "proceed" = approve_level
- "this looks good" = approve_level
- "ready for details" = approve_level
- Simple affirmative responses followed by progression language = approve_level

**EDIT PATTERNS FOR DESCRIPTION LEVEL:**
- "change the name to..." = edit_content
- "update the description to..." = edit_content
- "add to the scope..." = edit_content
- "remove from scope..." = edit_content`;

          case 'details':
            return `**CRITICAL APPROVAL PATTERNS FOR DETAILS LEVEL:**
- "good, let's move to acceptance criteria" = approve_level
- "let's move to testing requirements" = approve_level
- "move forward" or "proceed" = approve_level
- "this looks good" = approve_level
- "ready for acceptance criteria" = approve_level
- Simple affirmative responses followed by progression language = approve_level

**EDIT PATTERNS FOR DETAILS LEVEL:**
- "change the approach to..." = edit_content
- "add dependency on..." = edit_content
- "update the implementation..." = edit_content
- "depends on" or "dependency" = edit_content when modifying task dependencies`;

          case 'acceptanceCriteria':
            return `**CRITICAL APPROVAL PATTERNS FOR ACCEPTANCE_CRITERIA LEVEL:**
- "ready for implementation" = finalize
- "this is ready to work on" = finalize
- "task is complete and ready" = finalize
- "finalize this task" = finalize
- "approve for development" = finalize

**EDIT PATTERNS FOR ACCEPTANCE_CRITERIA LEVEL:**
- "change the testing requirements..." = edit_content
- "add test case for..." = edit_content
- "update acceptance criteria..." = edit_content
- "modify completion requirements..." = edit_content`;

          default:
            return `**GENERAL APPROVAL PATTERNS:**
- "good, let's move forward" = approve_level
- "this looks good" = approve_level
- "move forward" or "proceed" = approve_level
- "ready for next step" = approve_level

**GENERAL EDIT PATTERNS:**
- "change X to Y" = edit_content
- "add Z" = edit_content
- "remove A" = edit_content
- "update..." = edit_content`;
        }
      } catch (_error) {
        return '';
      }
    },
  );
  static readonly INTEGRATIONS = PlaceholderDefinition.create(
    'integrations',
    'Integration data',
    (ctx) =>
      PlaceholderContextUtils.getNodeContextValue(ctx, 'integrations', ''),
  );

  static readonly CATEGORY_SUBFACET_SUMMARIES =
    PlaceholderDefinition.createContentBlock(
      'categorySubfacetSummaries',
      'Subfacet rollups grouped by category with entity summaries and updated flags',
      async (
        ctx,
        options?: {
          category?: string;
          subfacet?: string;
          since?: string;
          maxPerCategory?: number;
          maxPerSubfacet?: number;
          mode?: 'detailed' | 'summary';
        },
      ) => {
        const { entitySummaryService } = ctx.services;
        if (!entitySummaryService) {
          return '';
        }

        const organizationId = PlaceholderContextUtils.getOrganizationId(ctx);
        const projectId = PlaceholderContextUtils.getProjectId(ctx);
        const since =
          typeof options?.since === 'string' && options.since
            ? new Date(options.since)
            : undefined;

        const maxPerCategory = Math.max(options?.maxPerCategory ?? 30, 1);
        const maxPerSubfacet = Math.max(options?.maxPerSubfacet ?? 10, 1);
        const mode = options?.mode === 'summary' ? 'summary' : 'detailed';

        const summaries =
          await entitySummaryService.getCurrentSummariesByCategory({
            organizationId,
            projectId,
            category: options?.category as SummaryCategory,
            since,
          });

        const grouped = new Map<
          string,
          Map<
            string,
            {
              entities: {
                entityType: string;
                entityId: string;
                summary: string;
                updatedAt: Date;
              }[];
              subfacetUpdatedAt?: Date;
            }
          >
        >();

        const subfacetFilter =
          typeof options?.subfacet === 'string' && options.subfacet
            ? options.subfacet.toLowerCase()
            : undefined;

        for (const item of summaries) {
          for (const sf of item.subfacets || []) {
            if (
              subfacetFilter &&
              sf.name.toLowerCase() !== subfacetFilter.trim()
            ) {
              continue;
            }
            const cat = item.category;
            if (!grouped.has(cat)) {
              grouped.set(cat, new Map());
            }

            const subMap = grouped.get(cat)!;
            if (!subMap.has(sf.name)) {
              subMap.set(sf.name, {
                entities: [],
                subfacetUpdatedAt: sf.updatedAt,
              });
            }

            const entry = subMap.get(sf.name)!;
            entry.entities.push({
              entityType: item.entityType,
              entityId: item.entityId,
              summary: item.summary,
              updatedAt: item.updatedAt,
            });
            if (
              !entry.subfacetUpdatedAt ||
              sf.updatedAt > entry.subfacetUpdatedAt
            ) {
              entry.subfacetUpdatedAt = sf.updatedAt;
            }
          }
        }

        if (!grouped.size) {
          return wrapWithDelimiters(
            'CATEGORY_SUBFACET_SUMMARIES',
            'No subfacet summaries available.',
          );
        }

        const lines: string[] = [];
        for (const [category, subfacets] of grouped.entries()) {
          lines.push(`CATEGORY: ${category}`);
          let usedForCategory = 0;
          let omittedForCategory = 0;
          let usedSubfacetCount = 0;

          const orderedSubfacets = Array.from(subfacets.entries()).sort(
            (a, b) => {
              const aDate = a[1].subfacetUpdatedAt?.getTime() ?? 0;
              const bDate = b[1].subfacetUpdatedAt?.getTime() ?? 0;
              return bDate - aDate;
            },
          );

          for (const [name, data] of orderedSubfacets) {
            if (mode === 'summary') {
              if (usedSubfacetCount >= maxPerCategory) {
                continue;
              }
            } else if (usedForCategory >= maxPerCategory) {
              omittedForCategory += data.entities.length;
              continue;
            }

            const sortedEntities = [...data.entities].sort(
              (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
            );

            if (mode === 'summary') {
              const summarySnippets: string[] = [];
              const seenSummaries = new Set<string>();
              for (const entity of sortedEntities) {
                const snippet = entity.summary.trim();
                if (!snippet || seenSummaries.has(snippet)) {
                  continue;
                }
                seenSummaries.add(snippet);
                summarySnippets.push(snippet);
                if (summarySnippets.length >= maxPerSubfacet) {
                  break;
                }
              }
              lines.push(`  - subfacet: ${name}`);
              lines.push(
                `    summary: ${summarySnippets.length ? summarySnippets.join(' ') : 'No summary available.'}`,
              );
              usedSubfacetCount += 1;
              continue;
            }

            const updatedSinceCutoff =
              since &&
              ((data.subfacetUpdatedAt &&
                data.subfacetUpdatedAt.getTime() >= since.getTime()) ||
                data.entities.some(
                  (e) => e.updatedAt.getTime() >= since.getTime(),
                ));
            const updatedTimestamp = data.subfacetUpdatedAt;
            lines.push(
              `  - subfacet: ${name} (last_updated: ${updatedTimestamp?.toISOString() ?? 'unknown'}, updated_since_cutoff: ${updatedSinceCutoff ? 'yes' : 'no'})`,
            );
            const remaining = maxPerCategory - usedForCategory;
            const takeCount = Math.min(
              Math.max(remaining, 0),
              Math.min(maxPerSubfacet, sortedEntities.length),
            );
            const sampled = sortedEntities.slice(0, takeCount);
            const omittedHere = sortedEntities.length - sampled.length;
            usedForCategory += sampled.length;
            omittedForCategory += omittedHere;

            for (const entity of sampled) {
              lines.push(
                `    • ${entity.entityType}:${entity.entityId} (updated ${entity.updatedAt.toISOString()}): ${entity.summary}`,
              );
            }

            if (omittedHere > 0) {
              lines.push(
                `    • … ${omittedHere} more entities omitted (sampling recent-first; max ${maxPerSubfacet} per subfacet)`,
              );
            }

            if (usedForCategory >= maxPerCategory) {
              break;
            }
          }

          if (mode === 'detailed' && omittedForCategory > 0) {
            lines.push(
              `  … ${omittedForCategory} entities omitted (sampling recent-first; max ${maxPerCategory} per category, ${maxPerSubfacet} per subfacet)`,
            );
          }
          lines.push('');
        }

        return wrapWithDelimiters(
          'CATEGORY_SUBFACET_SUMMARIES',
          lines.join('\n'),
        );
      },
    );

  static readonly TOPOLOGY_FIELDS_BULLETS =
    PlaceholderDefinition.createContentBlock(
      'topologyFieldsBullets',
      'Bullet list for topology fields (summary/category/subfacets)',
      () => {
        const bullets =
          `- summary: High-level summary of the requested work that matches the chosen category
- category: Must be one of "technology", "product", "process", or "people"
- subfacets: Up to three subfacets/themes under the chosen category`.trim();

        return bullets;
      },
    );

  static readonly TOPOLOGY_PROMPT = PlaceholderDefinition.createContentBlock(
    'topologyPrompt',
    'Minimal entity topology prompt (generation or post_hoc) with required fields and response format',
    (_ctx) => {
      const prompt = `
- Provide a concise summary of the requested work and ensure it aligns with the selected category
- Choose category from exactly: "technology", "product", "process", or "people"
- Provide up to three subfacets that roll up under the chosen category (e.g., for "technology": "architecture", "platform readiness", "observability")`;
      return wrapWithDelimiters('Topological Summary Guidance', prompt);
    },
  );

  static readonly CURRENT_LEVEL = PlaceholderDefinition.create(
    'currentLevel',
    'Current level string',
    (ctx) =>
      PlaceholderContextUtils.getNodeContextValue(
        ctx,
        'currentLevel',
        'unknown',
      ),
  );

  static readonly CONVERSATION_HISTORY_SIMPLE = PlaceholderDefinition.create(
    'conversation_history',
    'Simple conversation history',
    async (ctx) => {
      try {
        const artifacts = await ctx.services.artifactService.findMany?.(
          {
            projectId: ctx.flowContext.core.projectId,
            sourceId: String(ctx.flowContext.core.conversationId),
            status: 'ACTIVE',
            limit: 10,
          },
          ctx.flowContext.core.organizationId,
        );
        const artifactList = artifacts?.data;
        const history =
          StandardPlaceholderRegistry.formatConversationHistoryBlock(
            artifactList || [],
          );
        if (!history) {
          return '';
        }
        return wrapWithDelimiters('CONVERSATION_HISTORY_SIMPLE', history);
      } catch (_error) {
        return '';
      }
    },
  );

  static readonly PROJECT_MATURITY = PlaceholderDefinition.createContentBlock(
    'projectMaturity',
    'Project maturity explanation block',
    async (ctx) => {
      const artifacts = await ctx.services.artifactService.findMany?.(
        {
          projectId: ctx.flowContext.core.projectId,
          sourceId: String(ctx.flowContext.core.conversationId),
          status: 'ACTIVE',
          limit: 20,
          type: ArtifactType.QA_PAIR,
        },
        ctx.flowContext.core.organizationId,
      );

      const maturityQuestion = artifacts.data?.find(
        (qa) =>
          (qa.data as QAPairData).question ===
          'How would you describe the current state of this project?',
      );
      if (maturityQuestion) {
        const options = [
          {
            value: 'greenfield',
            label: 'New/Greenfield - Starting from scratch',
          },
          {
            value: 'early',
            label: 'Early - Some work complete',
          },
          {
            value: 'mature',
            label: 'Existing/Mature - Already in development or production',
          },
          {
            value: 'legacy',
            label:
              'Legacy - No longer under active development. Maintenance only.',
          },
        ];

        const value = options.find(
          (o) => o.label === (maturityQuestion.data as QAPairData).answer,
        )?.value;
        if (
          value &&
          maturityGuidanceMap[value as keyof typeof maturityGuidanceMap]
        ) {
          return wrapWithDelimiters(
            'PROJECT_MATURITY',
            maturityGuidanceMap[value as keyof typeof maturityGuidanceMap],
          );
        }
      }

      return wrapWithDelimiters(
        'PROJECT_MATURITY',
        Object.values(maturityGuidanceMap).join('\n\n'),
      );
    },
  );

  // Content Block Placeholders
  static readonly CONVERSATION_HISTORY =
    PlaceholderDefinition.createContentBlock(
      'conversationHistory',
      'Complete conversation history block',
      async (
        ctx,
        options?: {
          header?: string;
          includeCurrentMessage?: boolean;
          limit?: number;
        },
      ) => {
        console.log(
          '[CONVERSATION_HISTORY] starting,  ctx.options.includeHistory=',
          ctx.options.includeHistory,
        );
        // Check if conversation history is disabled
        if (ctx.options.includeHistory === false) {
          return '';
        }

        try {
          const artifacts = await ctx.services.artifactService.findMany?.(
            {
              projectId: ctx.flowContext.core.projectId,
              sourceId: String(ctx.flowContext.core.conversationId),
              status: 'ACTIVE',
              limit: options?.limit ?? 10,
              type: ArtifactType.QA_PAIR,
            },
            ctx.flowContext.core.organizationId,
          );
          console.log(
            '[CONVERSATION_HISTORY] loaded QA artifacts',
            artifacts?.data,
          );

          const artifactList = artifacts?.data || [];

          if (artifactList.length === 0) {
            return '';
          }

          const output =
            StandardPlaceholderRegistry.formatConversationHistoryBlock(
              artifactList,
            );
          const header =
            options?.header ?? '### You have had some previous conversation';

          console.log(
            '[CONVERSATION_HISTORY] includeCurrentMessage=',
            options?.includeCurrentMessage,
          );

          const content =
            options?.includeCurrentMessage === true
              ? `${header}\n${PlaceholderContextUtils.getUserMessageContent(ctx)}\n\n${output}`
              : `${header}\n${output}`;

          return wrapWithDelimiters('CONVERSATION_HISTORY', content);
        } catch (_error) {
          return '';
        }
      },
    );

  static readonly CONVERSATION_HISTORY_FINAL_ANSWER_IS_PROMPT =
    PlaceholderDefinition.createContentBlock(
      'conversationHistoryFinalAnswerIsPrompt',
      'Complete conversation history block that uses the final user answer as the prompt',
      async (ctx, options?: { header?: string }) => {
        try {
          const artifacts = await ctx.services.artifactService.findMany?.(
            {
              projectId: ctx.flowContext.core.projectId,
              sourceId: String(ctx.flowContext.core.conversationId),
              status: 'ACTIVE',
              limit: 20,
              type: ArtifactType.QA_PAIR,
            },
            ctx.flowContext.core.organizationId,
          );

          const artifactList = artifacts?.data ?? [];
          if (artifactList.length) {
            const previousQAs =
              StandardPlaceholderRegistry.formatConversationHistoryBlock(
                artifactList.slice(0, -1),
              );
            const header =
              options?.header ?? '### You have had some previous conversation';
            const lastArtifact = artifactList.at(-1);
            if (!lastArtifact) {
              return '';
            }
            const prompt = (lastArtifact.data as QAPairData).answer;

            const conversationHistory =
              artifactList.length > 1 ? `${header}\n${previousQAs}` : undefined;
            const currentQuestion = `### The user's current question\n${prompt}`;

            const content = [conversationHistory, currentQuestion]
              .filter(Boolean)
              .join('\n\n');

            return content
              ? wrapWithDelimiters(
                  'CONVERSATION_HISTORY_FINAL_ANSWER_IS_PROMPT',
                  content,
                )
              : '';
          }
          return '';
        } catch (_error) {
          return '';
        }
      },
    );

  static readonly CURRENT_INITIATIVE = PlaceholderDefinition.createContentBlock(
    'currentInitiative',
    'Full initiative context block',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative = await ctx.services.initiativeService.findOneForAdapter(
        initiativeId,
        ctx.flowContext.core.organizationId,
      );
      return StandardPlaceholderRegistry.buildCurrentInitiativeBlock(
        initiative,
      );
    },
  );

  static readonly INITIATIVE = PlaceholderDefinition.createContentBlock(
    'initiative',
    'Initiative summary block',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;

      const currentLevel = PlaceholderContextUtils.getNodeContextValue(
        ctx,
        'currentLevel',
        '',
      );
      const levelNames = PlaceholderContextUtils.getNodeContextValue(
        ctx,
        'levelNames',
        '',
      );
      return StandardPlaceholderRegistry.prototype.formatInitiativeForStandard(
        initiative,
        typeof currentLevel === 'string' ? currentLevel : 'unknown',
        Array.isArray(levelNames) ? levelNames : [],
      );
    },
  );

  static readonly INITIATIVE_TASKS = PlaceholderDefinition.createContentBlock(
    'initiative_tasks',
    'Initiative Tasks summary block',
    async (
      ctx,
      options?: {
        fields?: Array<'name' | 'description' | 'status' | 'priority'>;
      },
    ) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        return '';
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const tasks = await ctx.services.taskService.findAll(
        ctx.flowContext.core.organizationId,
        initiativeId,
      );
      return StandardPlaceholderRegistry.prototype.formatInitiativeTasks(
        tasks,
        options,
      );
    },
  );

  static readonly TASK_STUB_SESSION = PlaceholderDefinition.createContentBlock(
    'task_stub_session',
    'Task stub session summary block',
    async (ctx) => {
      const flowContext = ctx.flowContext as Partial<TaskGenerationFlowContext>;
      const session = flowContext.stubSession;
      if (!session?.stubs?.length) {
        return '';
      }

      const approved = session.stubs.filter(
        (stub) => stub.status === 'approved' || stub.status === 'user_added',
      );
      const rejected = session.stubs.filter(
        (stub) => stub.status === 'rejected',
      );
      const pending = session.stubs.filter(
        (stub) => stub.status === 'suggested',
      );

      const sections = [
        `Task Stub Iterations (Round ${session.round})`,
        formatTaskStubGroup('Approved or user supplied stubs', approved),
        formatTaskStubGroup('Rejected stubs to avoid', rejected),
        formatTaskStubGroup('Outstanding suggestions awaiting review', pending),
      ].filter(Boolean);

      return wrapWithDelimiters('TASK_STUB_SESSION', sections.join('\n\n'));
    },
  );

  static readonly INITIATIVE_STRICT = PlaceholderDefinition.createContentBlock(
    'initiative_STRICT',
    'Initiative summary block (strict mode)',
    async (ctx) => {
      if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
        throw new Error(
          `Could not find initiativeId for ${ctx.flowContext.flowId}`,
        );
      }
      const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
      const initiative =
        (await ctx.services.initiativeService.findOneForAdapter(
          initiativeId,
          ctx.flowContext.core.organizationId,
        )) as InitiativeResponseDto | null;

      if (!initiative) {
        throw new Error(`Could not find initiative for ${initiativeId}`);
      }

      const currentLevel = PlaceholderContextUtils.getNodeContextValue(
        ctx,
        'currentLevel',
        '',
      );
      const levelNames = PlaceholderContextUtils.getNodeContextValue(
        ctx,
        'levelNames',
        '',
      );
      return StandardPlaceholderRegistry.prototype.formatInitiativeForStandard(
        initiative,
        typeof currentLevel === 'string' ? currentLevel : 'unknown',
        Array.isArray(levelNames) ? levelNames : [],
      );
    },
  );

  // Flexible Artifact Influences Placeholder - can query by different source types
  static readonly ARTIFACT_INFLUENCES_BY_SOURCE =
    PlaceholderDefinition.createContentBlock(
      'artifactInfluencesBySource',
      'Artifact references for influence tracking by source type',
      async (ctx, options?: { sourceType?: 'INITIATIVE' | 'CONVERSATION' }) => {
        try {
          // Determine source based on context and options
          const sourceType = options?.sourceType || 'CONVERSATION';
          const sourceId =
            sourceType === 'INITIATIVE'
              ? PlaceholderContextUtils.requireInitiativeId(ctx)
              : String(ctx.flowContext.core.conversationId);

          const artifactList =
            await ctx.services.artifactService.findInfluences(
              {
                sourceId,
                sourceType,
              },
              ctx.flowContext.core.organizationId,
            );

          if (!artifactList || artifactList.length === 0) {
            return '';
          }

          return StandardPlaceholderRegistry.formatArtifactInfluences(
            artifactList,
          );
        } catch (_error) {
          return '';
        }
      },
    );

  // Initiative Context Artifacts - for task generation
  static readonly INITIATIVE_ARTIFACTS =
    PlaceholderDefinition.createContentBlock(
      'initiativeArtifacts',
      'Initiative artifacts including generation context',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          return '';
        }

        const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);

        try {
          // Fetch artifacts related to this initiative
          const artifacts = await ctx.services.artifactService.findMany?.(
            {
              projectId: ctx.flowContext.core.projectId,
              sourceType: 'INITIATIVE',
              sourceId: initiativeId,
              status: 'ACTIVE',
              limit: 20,
            },
            ctx.flowContext.core.organizationId,
          );

          const artifactList = artifacts?.data;

          if (!artifactList || artifactList.length === 0) {
            // Fallback to conversation artifacts if no initiative artifacts
            return await StandardPlaceholderRegistry.CONVERSATION_ARTIFACTS.resolve(
              ctx,
            );
          }

          const content = `
INITIATIVE GENERATION ARTIFACTS:
These artifacts show why this initiative was created and what influenced its design.

${formatArtifactsForPrompt(artifactList)}`.trim();
          return wrapWithDelimiters('INITIATIVE_ARTIFACTS', content);
        } catch (_error) {
          // Fallback to conversation artifacts
          return await StandardPlaceholderRegistry.CONVERSATION_ARTIFACTS.resolve(
            ctx,
          );
        }
      },
    );

  static readonly INSIGHT_ARTIFACTS = PlaceholderDefinition.createContentBlock(
    'initiativeArtifacts',
    'Initiative artifacts including generation context',
    async (ctx) => {
      try {
        // Fetch artifacts related to this initiative
        const artifacts = await ctx.services.artifactService.findMany?.(
          {
            projectId: ctx.flowContext.core.projectId,
            sourceType: 'CONVERSATION',
            sourceId: ctx.flowContext.core.conversationId,
            status: 'ACTIVE',
            type: ArtifactType.INSIGHT,
            limit: 20,
          },
          ctx.flowContext.core.organizationId,
        );

        const artifactList = artifacts?.data;

        if (!artifactList || artifactList.length === 0) {
          // Fallback to conversation artifacts if no initiative artifacts
          return await StandardPlaceholderRegistry.CONVERSATION_ARTIFACTS.resolve(
            ctx,
          );
        }

        const content = `
INSIGHTS:
Here are some insights and analysis of the user's messages.

${formatArtifactsForPrompt(artifactList)}`.trim();

        return wrapWithDelimiters('INSIGHT_ARTIFACTS', content);
      } catch (_error) {
        return '';
      }
    },
  );

  static readonly CONVERSATION_MENTIONS =
    PlaceholderDefinition.createContentBlock(
      'conversationMentions',
      'Mentions parsed from the conversation and current message',
      async (ctx) => {
        const messageService = ctx.services.messageService;
        if (!messageService?.getMentionsForConversation) {
          return '';
        }

        const entityRegistry = ctx.services.entityRegistryService;
        if (!entityRegistry || !entityRegistry.getEntitiesByIds) {
          throw new Error(
            'conversationMentions placeholder requires entityRegistryService.getEntitiesByIds',
          );
        }

        const organizationId = ctx.flowContext.core.organizationId;
        const conversationId = ctx.flowContext.core.conversationId;

        let mentions:
          | Array<{
              entityId: string;
              entityType: EntityType;
              messageId: string;
              conversationId: ConversationId;
              createdAt: Date;
            }>
          | undefined;

        try {
          mentions = await messageService.getMentionsForConversation(
            conversationId,
            organizationId,
          );
        } catch (_error) {
          return '';
        }

        if (!mentions || mentions.length === 0) {
          return '';
        }

        const deduped = new Map<
          string,
          {
            entityId: string;
            entityType: EntityType;
            messageId: string;
            firstSeenAt: Date;
          }
        >();

        for (const mention of mentions) {
          const key = `${mention.entityType}:${mention.entityId}`;
          if (deduped.has(key)) {
            continue;
          }

          deduped.set(key, {
            entityId: mention.entityId,
            entityType: mention.entityType,
            messageId: mention.messageId,
            firstSeenAt: mention.createdAt,
          });
        }

        const entities = Array.from(deduped.values());
        const namesByEntityId: Record<string, string | undefined> = {};

        try {
          const registryEntities = await entityRegistry.getEntitiesByIds({
            organizationId,
            entities: entities.map((entity) => ({
              entityId: entity.entityId,
              entityType: entity.entityType,
            })),
          });

          if (registryEntities) {
            for (const entity of registryEntities) {
              namesByEntityId[entity.entityId] = entity.entityName;
            }
          }
        } catch (_error) {
          // Best-effort enrichment; ignore lookup failures
        }

        const formattedMentions = await Promise.all(
          entities.map(async (entity) => {
            const formatted = await formatEntityForMention(ctx, {
              entityId: entity.entityId,
              entityType: entity.entityType,
              entityName: namesByEntityId[entity.entityId],
            });

            return {
              entityId: entity.entityId,
              entityType: entity.entityType,
              entityName: formatted.entityName,
              mentionToken: formatted.mentionToken,
              formatted: formatted.formatted,
              messageId: entity.messageId,
            };
          }),
        );

        const lines = formattedMentions.map((mention, index) => {
          const nameSuffix = mention.entityName
            ? ` (${mention.entityName})`
            : '';
          const mentionType = normalizeMentionType(mention.entityType);

          return `${index + 1}. ${mention.mentionToken} — ${mentionType}:${mention.entityId}${nameSuffix}`;
        });

        const formattedDetails = formattedMentions
          .filter((mention) => mention.formatted)
          .map((mention) => {
            return `${mention.mentionToken}:\n${mention.formatted}`;
          });

        const contentParts = [
          `MENTIONS (${formattedMentions.length})`,
          ...lines,
        ];

        if (formattedDetails.length > 0) {
          contentParts.push('', 'FORMATTED:', ...formattedDetails);
        }

        return wrapWithDelimiters(
          'CONVERSATION_MENTIONS',
          contentParts.join('\n'),
        );
      },
    );

  // Conversation Artifacts - original implementation kept for compatibility
  static readonly CONVERSATION_ARTIFACTS =
    PlaceholderDefinition.createContentBlock(
      'conversationArtifacts',
      'Structured artifact data from conversation',
      async (ctx, options) => {
        try {
          const artifacts = await ctx.services.artifactService.findMany?.(
            {
              projectId: ctx.flowContext.core.projectId,
              sourceId: String(ctx.flowContext.core.conversationId),
              status: 'ACTIVE',
              limit: 20,
            },
            ctx.flowContext.core.organizationId,
          );

          const artifactList = artifacts?.data;

          if (!artifactList || artifactList.length === 0) {
            return '';
          }

          const content = `
CONVERSATION ARTIFACTS:
Each artifact has a unique artifact_id that you can reference in the influences array.

${formatArtifactsForPrompt(artifactList, { includeType: true, includeTitle: true, includeContentHeader: true, includeTimestamp: (options?.includeTimestamp as boolean | undefined) ?? true })}`.trim();

          return wrapWithDelimiters('CONVERSATION_ARTIFACTS', content);
        } catch (_error) {
          return '';
        }
      },
    );

  static readonly CONTEXT_SEARCH_RESULTS =
    PlaceholderDefinition.createContentBlock(
      'contextSearchResults',
      'Embeddings search results scoped to the active context',
      async (
        ctx,
        options?: {
          query?: string;
          maxResults?: number;
          artifactTypes?: string | string[];
          tags?: string[];
          categories?: string[];
        },
      ) => {
        const artifactTypesOption = options?.artifactTypes;
        const artifactTypes = Array.isArray(artifactTypesOption)
          ? artifactTypesOption
          : typeof artifactTypesOption === 'string'
            ? artifactTypesOption
            : undefined;

        const searchResult = await getContextSearchResults(ctx, {
          query: typeof options?.query === 'string' ? options.query : undefined,
          maxResults:
            typeof options?.maxResults === 'number'
              ? options.maxResults
              : undefined,
          artifactTypes,
          tags:
            Array.isArray(options?.tags) && options.tags.length > 0
              ? options.tags
              : undefined,
          categories:
            Array.isArray(options?.categories) && options.categories.length > 0
              ? options.categories
              : undefined,
        });

        if (searchResult.status !== 'success') {
          return searchResult.message
            ? wrapWithDelimiters('CONTEXT_SEARCH_RESULTS', searchResult.message)
            : '';
        }

        if (searchResult.artifacts.length === 0) {
          return '';
        }

        const formattedResults = formatContextSearchResults(
          searchResult.artifacts,
        );

        return wrapWithDelimiters(
          'CONTEXT_SEARCH_RESULTS',
          `CONTEXT SEARCH RESULTS FOR "${searchResult.query}":\n${formattedResults}`,
        );
      },
    );

  static readonly CONTEXT_SEARCH_RESULTS_FOR_DESIGN_DOC =
    PlaceholderDefinition.createContentBlock(
      'contextSearchResultsForDesignDoc',
      'Embeddings search results using the current design doc context',
      async (
        ctx,
        options?: {
          maxResults?: number;
          artifactTypes?: string | string[];
          tags?: string[];
          categories?: string[];
        },
      ) => {
        const designDocId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
          ctx,
          'design-doc',
        ) as DesignDocId | undefined;

        if (!designDocId) {
          return '';
        }

        const designDocService = ctx.services.designDocService;

        if (!designDocService) {
          return '';
        }

        let designDoc: DesignDocSearchSource | null = null;

        try {
          designDoc = (await designDocService.findOneForAdapter(
            String(designDocId),
            ctx.flowContext.core.organizationId,
          )) as DesignDocSearchSource | null;
        } catch (error) {
          designDocContextSearchLogger.warn(
            'Failed to load design doc for context search placeholder',
            errorToLoggable(error),
          );
          return '';
        }

        if (!designDoc) {
          return '';
        }

        const queries = extractDesignDocSearchQueries(designDoc);

        if (queries.length === 0) {
          return '';
        }

        const artifactTypesOption = options?.artifactTypes;
        const artifactTypes = Array.isArray(artifactTypesOption)
          ? artifactTypesOption
          : typeof artifactTypesOption === 'string' &&
              artifactTypesOption.trim().length > 0
            ? artifactTypesOption
            : undefined;

        const tags =
          Array.isArray(options?.tags) && options.tags.length > 0
            ? options.tags
            : undefined;

        const categories =
          Array.isArray(options?.categories) && options.categories.length > 0
            ? options.categories
            : undefined;

        const headerLabel = formatDesignDocSearchLabel(designDoc, designDocId);
        const sections: string[] = [];
        const seenArtifactIds = new Set<string>();
        let encounteredUnavailable = false;

        for (const query of queries) {
          const searchResult = await getContextSearchResults(ctx, {
            query,
            fallbackQuery: query,
            maxResults:
              typeof options?.maxResults === 'number'
                ? options.maxResults
                : undefined,
            artifactTypes,
            tags,
            categories,
          });

          if (searchResult.status === 'unavailable') {
            if (searchResult.message) {
              sections.push(searchResult.message);
            }
            encounteredUnavailable = true;
            break;
          }

          if (searchResult.status !== 'success') {
            if (searchResult.message) {
              sections.push(searchResult.message);
            }
            continue;
          }

          const uniqueArtifacts = searchResult.artifacts.filter((artifact) => {
            if (!artifact || typeof artifact !== 'object') {
              return false;
            }

            const artifactId =
              'id' in artifact && typeof artifact.id === 'string'
                ? artifact.id
                : undefined;

            if (!artifactId) {
              return true;
            }

            if (seenArtifactIds.has(artifactId)) {
              return false;
            }

            seenArtifactIds.add(artifactId);
            return true;
          });

          if (uniqueArtifacts.length === 0) {
            continue;
          }

          const formattedResults = formatContextSearchResults(uniqueArtifacts);

          sections.push(
            `CONTEXT SEARCH RESULTS FOR "${searchResult.query}":\n${formattedResults}`,
          );
        }

        const combinedSections =
          sections.length > 0 ? sections.join('\n\n') : '';

        const content =
          encounteredUnavailable && sections.length === 1
            ? sections[0]
            : `DESIGN DOC CONTEXT SEARCH (${headerLabel})\n\n${combinedSections}`;

        return content
          ? wrapWithDelimiters('CONTEXT_SEARCH_RESULTS_FOR_DESIGN_DOC', content)
          : '';
      },
      'design-doc',
    );

  static readonly CONTEXT_SEARCH_RESULTS_FOR_INITIATIVE =
    PlaceholderDefinition.createContentBlock(
      'contextSearchResultsForInitiative',
      'Embeddings search results using the current initiative description',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          return '';
        }

        const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
        const initiative =
          (await ctx.services.initiativeService.findOneForAdapter(
            initiativeId,
            ctx.flowContext.core.organizationId,
          )) as InitiativeResponseDto | null;

        const content = getInitiativeSectionContent(initiative);
        const description = content.description?.trim();

        if (!description) {
          return '';
        }

        const searchResult = await getContextSearchResults(ctx, {
          query: description,
          fallbackQuery: description,
        });

        if (searchResult.status !== 'success') {
          return searchResult.message
            ? wrapWithDelimiters(
                'CONTEXT_SEARCH_RESULTS_FOR_INITIATIVE',
                searchResult.message,
              )
            : '';
        }

        if (searchResult.artifacts.length === 0) {
          return '';
        }

        const formattedResults = formatContextSearchResults(
          searchResult.artifacts,
        );

        return wrapWithDelimiters(
          'CONTEXT_SEARCH_RESULTS_FOR_INITIATIVE',
          `CONTEXT SEARCH RESULTS FOR INITIATIVE DESCRIPTION:\n${formattedResults}`,
        );
      },
      'initiative',
    );

  static readonly CONTEXT_SEARCH_RESULTS_FOR_TASK =
    PlaceholderDefinition.createContentBlock(
      'contextSearchResultsForTask',
      'Embeddings search results using the current task description',
      async (ctx) => {
        const taskId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
          ctx,
          'task',
        ) as TaskId | undefined;

        if (!taskId) {
          return '';
        }

        try {
          const task = await ctx.services.taskService.findOneForAdapter(
            String(taskId),
            ctx.flowContext.core.organizationId,
          );

          if (!task) {
            return '';
          }

          const content = materializedSectionsToContentMap(task.sections);
          const description = content.description.trim();

          if (!description) {
            return '';
          }

          const searchResult = await getContextSearchResults(ctx, {
            query: description,
            fallbackQuery: description,
          });

          if (searchResult.status !== 'success') {
            return searchResult.message
              ? wrapWithDelimiters(
                  'CONTEXT_SEARCH_RESULTS_FOR_TASK',
                  searchResult.message,
                )
              : '';
          }

          if (searchResult.artifacts.length === 0) {
            return '';
          }

          const formattedResults = formatContextSearchResults(
            searchResult.artifacts,
          );

          return wrapWithDelimiters(
            'CONTEXT_SEARCH_RESULTS_FOR_TASK',
            `CONTEXT SEARCH RESULTS FOR TASK DESCRIPTION:\n${formattedResults}`,
          );
        } catch (error) {
          return '';
        }
      },
    );

  static readonly DESIGN_DOC_LINKS = PlaceholderDefinition.createContentBlock(
    'designDocLinks',
    'Design Document linked entities (tasks, initiatives, design docs)',
    async (ctx) => {
      const designDocId = PlaceholderContextUtils.getTypedIdFromWorkflowAbout(
        ctx,
        'design-doc',
      ) as DesignDocId | undefined;

      if (!designDocId) {
        return '';
      }

      try {
        // Fetch all links for this design doc
        const links = await ctx.services.designDocService.getLinks(
          designDocId as string,
          ctx.flowContext.core.organizationId,
        );

        if (!links || links.length === 0) {
          return '';
        }

        // Group links by entity type
        const taskLinks = links.filter((link) => link.entityType === 'task');
        const designDocLinks = links.filter(
          (link) => link.entityType === 'design-doc',
        );

        // Fetch full details for each entity type
        type LinkWithEntity = {
          link: DesignDocLinkResponseDto;
          entity: unknown;
        };

        const fetchTask = async (
          link: DesignDocLinkResponseDto,
        ): Promise<LinkWithEntity> => {
          const entity = await ctx.services.taskService
            .findOneForAdapter(
              link.entityId,
              ctx.flowContext.core.organizationId,
            )
            .catch((): null => null);
          return { link, entity };
        };

        const fetchDesignDoc = async (
          link: DesignDocLinkResponseDto,
        ): Promise<LinkWithEntity> => {
          const entity = await ctx.services.designDocService
            .findOneForAdapter(
              link.entityId,
              ctx.flowContext.core.organizationId,
            )
            .catch((): null => null);
          return { link, entity };
        };

        const [tasks, designDocs] = await Promise.all([
          Promise.all(taskLinks.map(fetchTask)),
          Promise.all(designDocLinks.map(fetchDesignDoc)),
        ]);

        // Build formatted output
        const sections: string[] = [];

        if (tasks.length > 0) {
          sections.push('**LINKED TASKS:**');
          tasks.forEach(({ entity }) => {
            if (entity && typeof entity === 'object' && 'name' in entity) {
              const task = entity as TaskResponseDto;
              const taskContent = materializedSectionsToContentMap(
                task.sections,
              );
              sections.push(
                `- ${task.name || 'Untitled Task'} (${task.status || 'No status'})`,
              );
              const description = taskContent.description;
              if (description) {
                sections.push(`  Description: ${description}`);
              }
            }
          });
        }

        if (designDocs.length > 0) {
          sections.push('\n**RELATED DESIGN DOCUMENTS:**');
          designDocs.forEach(({ entity }) => {
            if (entity && typeof entity === 'object' && 'name' in entity) {
              const doc = entity as {
                name?: string;
                template?: string;
                sections?: Array<{ key: string; content?: string }>;
              };
              sections.push(
                `- ${doc.name || 'Untitled Design Doc'} (${doc.template || 'Unknown template'})`,
              );
              const contextSection = doc.sections?.find(
                (s) => s.key === 'context',
              );
              if (contextSection?.content) {
                sections.push(`  Context: ${contextSection.content}`);
              }
            }
          });
        }

        return sections.length > 0
          ? wrapWithDelimiters('DESIGN_DOC_LINKS', sections.join('\n'))
          : '';
      } catch (_error) {
        return '';
      }
    },
  );

  constructor() {
    super('standard');
    this.registerAllStandardPlaceholders();
  }

  private registerAllStandardPlaceholders(): void {
    // Register all static placeholders
    this.registerAll([
      // Simple Value Placeholders - IDs and Context
      StandardPlaceholderRegistry.WORKFLOW_ID,
      StandardPlaceholderRegistry.ORGANIZATION_ID,
      StandardPlaceholderRegistry.PROJECT_ID,
      StandardPlaceholderRegistry.CONVERSATION_ID,
      StandardPlaceholderRegistry.INTERACTION_COUNT,

      // Current Message Placeholders
      StandardPlaceholderRegistry.CURRENT_MESSAGE,
      StandardPlaceholderRegistry.MESSAGE,

      // Initiative Simple Fields
      StandardPlaceholderRegistry.INITIATIVE_NAME,
      StandardPlaceholderRegistry.INITIATIVE_DESCRIPTION,
      StandardPlaceholderRegistry.INITIATIVE_PRIORITY,
      StandardPlaceholderRegistry.INITIATIVE_TAGS,
      StandardPlaceholderRegistry.INITIATIVE_CURRENT_LEVEL,

      // Database Entity Fields ($ prefix)
      StandardPlaceholderRegistry.INITIATIVE_REASONING,

      // Task/Project Fields - from workflowAboutId/Type
      StandardPlaceholderRegistry.TASK,
      StandardPlaceholderRegistry.DESIGN_DOC,
      StandardPlaceholderRegistry.DESIGN_DOC_SUMMARY,
      StandardPlaceholderRegistry.DESIGN_DOC_LINKS,
      StandardPlaceholderRegistry.TASK_LEVEL_CLASSIFICATION_RULES,
      StandardPlaceholderRegistry.TASK_LEVEL_APPROVAL_PATTERNS,
      // Analysis Fields - from node's buildContext() method
      StandardPlaceholderRegistry.INTEGRATIONS,
      StandardPlaceholderRegistry.CURRENT_LEVEL,

      // Legacy template placeholders (single braces)
      StandardPlaceholderRegistry.CONVERSATION_HISTORY_SIMPLE,

      // Content Block Placeholders
      StandardPlaceholderRegistry.CONVERSATION_HISTORY,
      StandardPlaceholderRegistry.CONVERSATION_HISTORY_FINAL_ANSWER_IS_PROMPT,
      StandardPlaceholderRegistry.PROJECT_MATURITY,
      StandardPlaceholderRegistry.CURRENT_INITIATIVE,
      StandardPlaceholderRegistry.INITIATIVE,
      StandardPlaceholderRegistry.INITIATIVE_TASKS,
      StandardPlaceholderRegistry.INITIATIVE_STRICT,
      StandardPlaceholderRegistry.TASK_STUB_SESSION,
      StandardPlaceholderRegistry.ARTIFACT_INFLUENCES_BY_SOURCE,
      StandardPlaceholderRegistry.INITIATIVE_ARTIFACTS,
      StandardPlaceholderRegistry.CONVERSATION_ARTIFACTS,
      StandardPlaceholderRegistry.CONVERSATION_MENTIONS,
      StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS,
      StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS_FOR_DESIGN_DOC,
      StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS_FOR_INITIATIVE,
      StandardPlaceholderRegistry.CONTEXT_SEARCH_RESULTS_FOR_TASK,
      StandardPlaceholderRegistry.CATEGORY_SUBFACET_SUMMARIES,
      StandardPlaceholderRegistry.TOPOLOGY_FIELDS_BULLETS,
      StandardPlaceholderRegistry.TOPOLOGY_PROMPT,
    ]);

    // Register additional placeholders not converted to static yet
    this.registerAll([
      this.createInitiativeLevelProgressPlaceholder(),
      this.createInitiativeLevelDescriptionPlaceholder(),
    ]);

    // Register strict variants
    this.registerAll([
      this.createInitiativeLevelProgressPlaceholderStrict(),
      this.createInitiativeLevelDescriptionPlaceholderStrict(),
    ]);
  }

  // ===================
  // Legacy Private Methods (kept for backward compatibility)
  // ===================

  private createInitiativeLevelProgressPlaceholder(): PlaceholderDefinition<string> {
    return PlaceholderDefinition.create(
      'initiative.levelProgress',
      'Level progress',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          return '';
        }

        try {
          const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
          const initiative =
            (await ctx.services.initiativeService.findOneForAdapter(
              initiativeId,
              ctx.flowContext.core.organizationId,
            )) as InitiativeResponseDto | null;

          return this.mapInitiativeStatusToLevel(initiative?.status).progress;
        } catch (error) {
          this.logger.error(
            'Failed to fetch initiative for levelProgress placeholder',
            {
              error: errorToLoggable(error),
            },
          );
          throw error;
        }
      },
    );
  }

  private createInitiativeLevelDescriptionPlaceholder(): PlaceholderDefinition<string> {
    return PlaceholderDefinition.create(
      'initiative.levelDescription',
      'Level description',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          return '';
        }

        try {
          const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
          const initiative =
            (await ctx.services.initiativeService.findOneForAdapter(
              initiativeId,
              ctx.flowContext.core.organizationId,
            )) as InitiativeResponseDto | null;

          return this.mapInitiativeStatusToLevel(initiative?.status)
            .description;
        } catch (error) {
          this.logger.error(
            'Failed to fetch initiative for levelDescription placeholder',
            {
              error: errorToLoggable(error),
            },
          );
          throw error;
        }
      },
    );
  }

  private createInitiativeLevelProgressPlaceholderStrict(): PlaceholderDefinition<string> {
    return PlaceholderDefinition.create(
      'initiative.levelProgress_STRICT',
      'Level progress (strict mode)',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          throw new Error(
            `Could not find initiativeId for ${ctx.flowContext.flowId}`,
          );
        }

        const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
        const initiative =
          (await ctx.services.initiativeService.findOneForAdapter(
            initiativeId,
            ctx.flowContext.core.organizationId,
          )) as InitiativeResponseDto | null;

        if (!initiative) {
          throw new Error(`Could not find initiative for ${initiativeId}`);
        }

        if (!initiative.status) {
          throw new Error(`Initiative ${initiativeId} has no status`);
        }

        return this.mapInitiativeStatusToLevel(initiative.status).progress;
      },
    );
  }

  private createInitiativeLevelDescriptionPlaceholderStrict(): PlaceholderDefinition<string> {
    return PlaceholderDefinition.create(
      'initiative.levelDescription_STRICT',
      'Level description (strict mode)',
      async (ctx) => {
        if (!PlaceholderContextUtils.hasInitiativeContext(ctx)) {
          throw new Error(
            `Could not find initiativeId for ${ctx.flowContext.flowId}`,
          );
        }

        const initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
        const initiative =
          (await ctx.services.initiativeService.findOneForAdapter(
            initiativeId,
            ctx.flowContext.core.organizationId,
          )) as InitiativeResponseDto | null;

        if (!initiative) {
          throw new Error(`Could not find initiative for ${initiativeId}`);
        }

        if (!initiative.status) {
          throw new Error(`Initiative ${initiativeId} has no status`);
        }

        return this.mapInitiativeStatusToLevel(initiative.status).description;
      },
    );
  }

  // ===================
  // Helper/Formatting Methods
  // ===================

  /**
   * Maps initiative status to level information
   * TODO: Import actual mapping utility when available
   */
  private mapInitiativeStatusToLevel(status?: string): {
    level: string;
    progress: string;
    description: string;
  } {
    // Placeholder implementation - should use actual utility
    switch (status) {
      case 'REFINING_DESCRIPTION':
        return {
          level: 'description',
          progress: 'in_progress',
          description: 'Refining the initiative description',
        };
      case 'REFINING_DETAILS':
        return {
          level: 'details',
          progress: 'in_progress',
          description: 'Working on technical details',
        };
      case 'REFINING_ACCEPTANCE_CRITERIA':
        return {
          level: 'acceptanceCriteria',
          progress: 'in_progress',
          description: 'Defining acceptance criteria',
        };
      default:
        return {
          level: status || 'unknown',
          progress: 'unknown',
          description: 'Status mapping not available',
        };
    }
  }

  static formatConversationHistoryBlock(
    artifacts: ArtifactResponseDto[],
  ): string {
    if (!artifacts || artifacts.length === 0) {
      return '';
    }

    const qaPairArtifacts = artifacts.filter(
      (a) => (a.data as QAPairData)?.type === 'QA_PAIR',
    );

    const entries = reconstructConversationFromQaPairs(qaPairArtifacts, {
      includeType: false,
      includeTitle: false,
    });
    if (!entries.length) {
      return '';
    }

    return JSON.stringify(entries, null, 2);
  }

  static formatArtifactInfluences(artifacts: ArtifactResponseDto[]): string {
    if (!artifacts || artifacts.length === 0) {
      return '';
    }

    const content = artifacts
      .map((artifact) => {
        return [
          `type: ${artifactTypeToFriendlyType(artifact.type)}`,
          `${extractArtifactContent(artifact, true)}`,
        ].join('\n');
      })
      .join('\n\n');

    return wrapWithDelimiters('ARTIFACT_INFLUENCES', content);
  }

  static buildCurrentInitiativeBlock(
    initiative: InitiativeResponseDto | null,
  ): string {
    if (!initiative) {
      return '';
    }

    const sectionContent = getInitiativeSectionContent(initiative);
    const content = `
CURRENT INITIATIVE: ${initiative.name || 'Unnamed'}

Description: ${sectionContent.description || 'No description'}
Priority: ${initiative.priority || 'Not set'}  
Status: ${initiative.status || 'Unknown'}
Tags: ${initiative.tags?.join(', ') || 'None'}

${initiative.reasoning ? `Reasoning: ${initiative.reasoning}` : ''}
    `.trim();

    return wrapWithDelimiters('CURRENT_INITIATIVE', content);
  }

  formatInitiativeForStandard(
    initiative: InitiativeResponseDto | null,
    _currentLevel?: string,
    _levelNames?: string[],
  ): string {
    if (!initiative) {
      return '';
    }

    const content = getInitiativeSectionContent(initiative);
    const sections: string[] = [
      `Initiative: ${initiative.name || 'Unnamed'}`,
      `Status: ${initiative.status || 'Unknown'}`,
    ];

    if (content.description) {
      sections.push('', `Description:\n${content.description}`);
    }
    if (content.details) {
      sections.push('', `Details:\n${content.details}`);
    }
    if (content.acceptanceCriteria) {
      sections.push('', `Acceptance Criteria:\n${content.acceptanceCriteria}`);
    }

    return wrapWithDelimiters('INITIATIVE', sections.join('\n'));
  }

  formatTaskForStandard(
    task: TaskResponseDto | null,
    options?: {
      include?: {
        name?: boolean;
        status?: boolean;
        priority?: boolean;
        assignee?: boolean;
        dueDate?: boolean;
        description?: boolean;
        details?: boolean;
        acceptanceCriteria?: boolean;
      };
    },
  ): string {
    if (!task) {
      return '';
    }

    const include = {
      name: true,
      status: true,
      priority: true,
      assignee: true,
      dueDate: true,
      description: true,
      details: true,
      acceptanceCriteria: true,
      ...(options?.include ?? {}),
    };

    const content = materializedSectionsToContentMap(task.sections);
    let output = '';

    if (include.name) {
      output += `Task: ${task.name || 'Untitled Task'}\n`;
    }
    if (include.status) {
      output += `Status: ${task.status || 'Unknown'}\n`;
    }
    if (include.priority) {
      output += `Priority: ${task.priority || 'Not set'}\n`;
    }
    if (include.assignee) {
      output += `Assignee: ${task.assigneeId || 'Unassigned'}\n`;
    }
    if (include.dueDate && task.dueDate) {
      output += `Due Date: ${task.dueDate}\n`;
    }

    if (include.description && content.description) {
      output += `\nDescription:\n${content.description}`;
    }
    if (include.details && content.details) {
      output += `\nDetails:\n${content.details}`;
    }
    if (include.acceptanceCriteria && content.acceptanceCriteria) {
      output += `\nAcceptance Criteria:\n${content.acceptanceCriteria}`;
    }

    return wrapWithDelimiters('TASK', output.trim());
  }

  buildFlowContextSection(flowContext: FlowContext): string {
    const content = `
FLOW CONTEXT:
- Flow ID: ${flowContext.flowId}
- Workflow: ${flowContext.core.workflowId}
- Project: ${flowContext.core.projectId}
- Organization: ${flowContext.core.organizationId}
- User: ${flowContext.core.user.id} (${flowContext.core.user.role})
- Session: ${flowContext.core.session?.interactionCount || 0} interactions
    `.trim();

    return wrapWithDelimiters('FLOW_CONTEXT', content);
  }

  buildNodeContextSection(nodeData: NodeContextData): string {
    let output = `NODE CONTEXT:\n`;
    output += `- Node ID: ${nodeData.id}\n`;
    output += `- Node Type: ${nodeData.type}\n`;

    if (nodeData.title) {
      output += `- Title: ${nodeData.title}\n`;
    }

    return wrapWithDelimiters('NODE_CONTEXT', output.trim());
  }

  formatInitiativeTasks(
    tasks: TaskResponseDto[],
    options?: {
      fields?: Array<'name' | 'description' | 'status' | 'priority'>;
    },
  ): string {
    if (!tasks || tasks.length === 0) {
      return '';
    }

    const fields = options?.fields ?? [
      'name',
      'description',
      'status',
      'priority',
    ];

    const taskSummaries = tasks
      .map((task, index) => {
        let summary;
        if (fields.includes('name')) {
          const title = task.name || 'Untitled Task';
          summary = `${index + 1}. ${title}\n`;
        }
        if (fields.includes('status')) {
          const status = task.status || 'Unknown';
          summary += `   Status: ${status}\n`;
        }
        if (fields.includes('description')) {
          // Truncate description to ~100 characters
          const content = materializedSectionsToContentMap(task.sections);
          const fullDescription = content.description || '';
          let descriptionPreview = '';
          if (fullDescription) {
            descriptionPreview =
              fullDescription.length > 100
                ? `${fullDescription.substring(0, 100)}...`
                : fullDescription;
          }

          if (descriptionPreview) {
            summary += `   Description: ${descriptionPreview}\n`;
          }
        }
        if (fields.includes('priority')) {
          const priority = task.priority || 'Not set';
          summary += `   Priority: ${priority}\n`;
        }

        return summary;
      })
      .join('\n');

    return wrapWithDelimiters(
      'INITIATIVE_TASKS',
      `INITIATIVE TASKS (${tasks.length}):\n\n${taskSummaries}`,
    );
  }
}

type MentionedEntity = {
  entityId: string;
  entityType: EntityType;
  entityName?: string;
};

async function formatEntityForMention(
  ctx: PlaceholderContext,
  entity: MentionedEntity,
): Promise<{
  entityName: string;
  mentionToken: string;
  formatted?: string;
}> {
  const normalizedType = normalizeMentionType(entity.entityType);
  const formatter = StandardPlaceholderRegistry.prototype;
  const organizationId = ctx.flowContext.core.organizationId;
  const baseName = entity.entityName?.trim() || entity.entityId;
  let entityName = baseName;
  let formatted: string | undefined;

  switch (normalizedType) {
    case 'task': {
      const taskService = ctx.services.taskService;
      if (
        !taskService ||
        typeof taskService.findOneByOrganization !== 'function'
      ) {
        throw new Error(
          'conversationMentions placeholder requires taskService.findOneByOrganization',
        );
      }

      try {
        const task = await taskService.findOneByOrganization(
          organizationId,
          entity.entityId as TaskId,
        );

        if (task) {
          entityName = task.name || entityName;
          formatted = formatter.formatTaskForStandard.call(formatter, task, {
            include: {
              name: true,
              status: false,
              priority: false,
              assignee: false,
              dueDate: false,
              description: true,
              details: true,
              acceptanceCriteria: true,
            },
          });
        }
      } catch (_error) {
        // Best-effort formatting; fall back to base naming
      }
      break;
    }
    case 'initiative': {
      const initiativeService = ctx.services.initiativeService;
      if (
        !initiativeService ||
        typeof initiativeService.findOneForAdapter !== 'function'
      ) {
        throw new Error(
          'conversationMentions placeholder requires initiativeService.findOneForAdapter',
        );
      }

      try {
        const initiative = await initiativeService.findOneForAdapter(
          entity.entityId,
          organizationId,
        );

        if (initiative) {
          entityName = initiative.name || entityName;
          formatted = formatter.formatInitiativeForStandard.call(
            formatter,
            initiative,
          );
        }
      } catch (_error) {
        // Best-effort formatting; fall back to base naming
      }
      break;
    }
    case 'design-doc': {
      const designDocService = ctx.services.designDocService;
      if (!designDocService || typeof designDocService.findOne !== 'function') {
        throw new Error(
          'conversationMentions placeholder requires designDocService.findOne',
        );
      }

      try {
        const designDoc = await designDocService.findOne(
          entity.entityId,
          organizationId,
        );
        if (designDoc) {
          entityName = designDoc.name || designDoc.summary || entityName;

          const summary = designDoc.summary;

          const label = formatDesignDocSearchLabel(
            designDoc,
            designDoc.id as DesignDocId,
          );

          const sections = [
            `Design Doc: ${label}`,
            summary ? `Summary:\n${summary}` : undefined,
          ].filter(Boolean);

          formatted =
            sections.length > 0
              ? wrapWithDelimiters('DESIGN_DOC', sections.join('\n\n'))
              : undefined;
        }
      } catch (_error) {
        // Best-effort formatting; fall back to base naming
      }
      break;
    }
    case 'artifact': {
      const artifactService = ctx.services.artifactService;
      if (!artifactService || typeof artifactService.findOne !== 'function') {
        throw new Error(
          'conversationMentions placeholder requires artifactService.findOne',
        );
      }

      try {
        const artifact = await artifactService.findOne(
          entity.entityId,
          organizationId,
        );

        if (artifact) {
          entityName = artifact.title || entityName;
          formatted = wrapWithDelimiters(
            'ARTIFACT',
            formatArtifactsForPrompt([artifact], {
              includeType: true,
              includeTitle: true,
              includeContentHeader: true,
            }),
          );
        }
      } catch (_error) {
        // Best-effort formatting; fall back to base naming
      }
      break;
    }
    default:
      break;
  }

  return {
    entityName,
    mentionToken: formatMention({
      entityType: normalizedType,
      entityId: entity.entityId,
      entityName,
    }),
    formatted,
  };
}
