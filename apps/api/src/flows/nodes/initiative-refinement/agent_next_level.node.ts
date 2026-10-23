import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  Influence,
  InitiativeSectionUpdateSource,
  UIElement,
  WorkItemSectionInput,
  WorkStatus,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import {
  getNextSectionFromStatus,
  getNextStatus,
  getPreviousSection,
  getWorkItemSections,
} from 'src/utils/work-item.util';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  CompensationContext,
  CompensationResult,
  InitiativeRefinementFlowContext,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';
import { AgentNodeBase } from '../base';
import { getCommonAgentInput } from './agent-utils';
import {
  InitiativeRefinerRequest,
  InitiativeRefinerResponse,
  InitiativeRefinerResponseSchema,
} from './types';

// Configuration for this agent node
const config = {
  nodeId: 'agent_next_level',
  title: 'AI Next Level Generation',
} as const;

/**
 * Initiative Agent Next Level node - generates content for the next refinement level
 * System-initiated (no user message required) - triggered by /deepen endpoint
 */
@Injectable()
export class InitiativeRefinementAgentNextLevelNode extends AgentNodeBase<
  InitiativeRefinementFlowContext,
  (InitiativeRefinerRequest & Record<string, unknown>) | undefined
> {
  readonly id = INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL;
  readonly title = config.title;
  readonly responseSchema = InitiativeRefinerResponseSchema;

  private readonly logger = new Logger(
    InitiativeRefinementAgentNextLevelNode.name,
  );

  constructor(
    private initiativeService: InitiativeService,
    private artifactService: ArtifactService,
  ) {
    super();
  }

  readonly agentId = 'initiative-refiner';

  readonly agentInput = async (
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<
    (InitiativeRefinerRequest & Record<string, unknown>) | undefined
  > => {
    const context = tracker.getContext();
    const initiative = await this.initiativeService.findOneForAdapter(
      context.initiativeId,
      context.core.organizationId,
    );
    if (!initiative) {
      throw new Error(
        `Initiative ${context.initiativeId} not found while building agent input`,
      );
    }
    const nextSection = getNextSectionFromStatus(initiative.status);
    const previousSection = getPreviousSection(nextSection);

    if (!nextSection) {
      this.logger.warn(
        'No next level available - initiative is at final refinement stage',
        {
          initiativeId: context.initiativeId,
          previousSection,
        },
      );
      return undefined;
    }

    // Determine generation type based on target field content
    const targetFieldMap = {
      description: 'description',
      details: 'details',
      acceptanceCriteria: 'acceptanceCriteria',
    } as const;
    const targetField = targetFieldMap[nextSection];
    const sectionContent = materializedSectionsToContentMap(
      initiative.sections,
    );
    const targetFieldValue = sectionContent[targetField];
    const isTargetEmpty =
      !targetFieldValue ||
      (typeof targetFieldValue === 'string' && targetFieldValue.trim() === '');

    const lastUserMessage = isTargetEmpty
      ? `Generate initial content for the ${nextSection} section based on the existing initiative information.`
      : `Update the ${nextSection} section to reflect changes made to the ${previousSection} section.`;

    const out = await getCommonAgentInput(
      context,
      { content: lastUserMessage, id: undefined },
      initiative,
      this.artifactService,
      this.logger,
      { requiredOps: 1 },
    );

    return out as
      | (InitiativeRefinerRequest & Record<string, unknown>)
      | undefined;
  };

  readonly userPrompt = '';

  async buildContext(
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      initiativeId: context.initiativeId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<InitiativeRefinerResponse>,
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    const context = tracker.getContext();
    try {
      this.logger.debug('Initiative next level agent response received:', {
        result: agentResponse.result,
      });

      // Validate agent response has result
      if (!agentResponse.result) {
        this.logger.error(
          'Initiative next level agent response missing result field:',
          {
            executionId: agentResponse.executionId,
            status: agentResponse.status,
            error: agentResponse.error,
          },
        );
        return {
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Initiative next level agent response missing result field',
        };
      }
      const initiative = await this.initiativeService.findOne(
        context.initiativeId,
        context.core.organizationId,
      );
      if (!initiative) {
        throw new Error(
          `Initiative ${context.initiativeId} not found in organization ${context.core.organizationId}`,
        );
      }

      const { nextSection } = getWorkItemSections(
        initiative.status as WorkStatus,
      );
      if (!nextSection) {
        this.logger.warn(
          'Initiative has no next section while processing agent response',
          {
            initiativeId: context.initiativeId,
            status: initiative.status,
          },
        );
        return {
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Initiative has no next section for refinement',
        };
      }

      // Validate response schema
      const parseResult = InitiativeRefinerResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error(
          'Initiative next level agent response validation failed:',
          {
            executionId: agentResponse.executionId,
            error: parseResult.error,
          },
        );
        return {
          nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'Initiative next level agent response validation failed',
        };
      }

      const agentData = parseResult.data;

      // Get all ops targeting nextSection or any later sections
      const sectionOrder = [
        'description',
        'details',
        'acceptanceCriteria',
      ] as const;
      const nextSectionIndex = sectionOrder.indexOf(nextSection);
      const applicableSections = sectionOrder.slice(nextSectionIndex);

      const isApplicableTarget = (
        target: string | undefined,
      ): target is (typeof sectionOrder)[number] =>
        !!target &&
        applicableSections.includes(target as (typeof sectionOrder)[number]);

      type AgentOp = NonNullable<typeof agentData.ops>[number];
      const hasApplicableTarget = (
        op: AgentOp,
      ): op is AgentOp & { target: (typeof sectionOrder)[number] } =>
        isApplicableTarget(op.target);

      const fieldUpdates = agentData.ops?.filter(hasApplicableTarget) || [];

      const update: {
        status: WorkStatus;
        sections?: WorkItemSectionInput[];
        sectionUpdateSource?: InitiativeSectionUpdateSource;
      } = {
        status: getNextStatus(initiative.status),
        sections: fieldUpdates.map((fieldUpdate) => ({
          key: fieldUpdate.target,
          content: fieldUpdate.text,
          order: sectionOrder.indexOf(fieldUpdate.target),
        })),
        sectionUpdateSource: fieldUpdates.length
          ? InitiativeSectionUpdateSource.AgentSuggested
          : undefined,
      };

      await this.initiativeService.updateForAdapter(
        initiative.id,
        update,
        initiative.organizationId,
      );

      // Build UI element for agent response
      const responseFieldId = uuidv4();
      const uiElement: UIElement = {
        id: responseFieldId,
        type: 'agent_response',
        label: 'Review the generated content',
        placeholder: 'Share your feedback...',
        required: false,
        influences: (agentData.influences || []) as Influence[],
      };

      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      this.logger.log('Initiative next level agent response processed:', {
        executionId: agentResponse.executionId,
        operationsCount: agentData.ops?.length,
        hasInfluences: !!agentData.influences?.length,
        sectionCompleteConfidence: agentData.sectionCompleteConfidence,
      });

      return {
        nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          title: this.title,
          response:
            agentData.response ||
            'Here is the generated content for the next section:',
          ...(secondaryActions.length ? { secondaryActions } : {}),
          uiElements: [uiElement],
        },
      };
    } catch (error) {
      this.logger.error(
        'Error in initiative next level agent processing:',
        error,
      );
      return {
        nextNodeId: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async compensate(
    _context: InitiativeRefinementFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Agent timeouts - longer delay, more retries for complex reasoning
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 5000; // Progressive: 10s, 15s, 20s
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Agent generation timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    // Agent service issues - try with extended delay
    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'Agent service issue, retrying with extended delay',
      };
    }

    // Rate limiting - agent-specific delays
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 20000, // Longer delay for agent rate limits
        reason: 'Agent rate limited, extended delay before retry',
      };
    }

    // Max attempts - fallback to prompt input for manual handling
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT,
        reason:
          'Initiative next level generation failed, falling back to manual input',
      };
    }

    return { action: 'FAIL' };
  }
}
