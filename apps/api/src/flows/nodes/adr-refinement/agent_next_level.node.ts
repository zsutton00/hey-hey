import { Injectable, Logger } from '@nestjs/common';
import { uuidv4 } from 'lib0/random';
import {
  AdrStatus,
  ExtendedUIFieldType,
  Influence,
  UIElement,
} from 'src/generated';
import { AdrActiveSectionEnum } from 'src/generated/agents/models';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { DesignDocId } from 'src/types';
import { MastraAgentResponse } from '../../../services/agents/mastra-client.service';
import {
  AdrRefinementFlowContext,
  CompensationContext,
  CompensationResult,
  ProcessAgentResponseResult,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';
import { buildRelatedEntitiesSecondaryActions } from '../../utils/secondary-actions.util';
import { AgentNodeBase } from '../base';
import {
  AdrAgentResponse,
  AdrAgentResponseSchema,
  AdrRefinerAgentInput,
  AdrRefinerAgentInputSchema,
} from './adr-agent.schemas';

interface GenerationTarget {
  sectionKey: 'decision' | 'consequences';
  completedStatus: AdrStatus;
  label: string;
}

@Injectable()
export class AdrRefinementAgentNextLevelNode extends AgentNodeBase<
  AdrRefinementFlowContext,
  AdrRefinerAgentInput | undefined
> {
  readonly id = ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL;
  readonly title = 'AI Next Stage Generation';
  readonly responseSchema = AdrAgentResponseSchema;
  readonly agentId = 'adr-refiner';
  readonly userPrompt = '';

  private readonly logger = new Logger(AdrRefinementAgentNextLevelNode.name);

  constructor(private readonly designDocService: DesignDocService) {
    super();
  }

  readonly agentInput = async (
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<AdrRefinerAgentInput | undefined> => {
    const context = tracker.getContext();
    const designDoc = await this.designDocService.findOneForAdapter(
      context.designDocId,
      context.core.organizationId,
    );

    if (!designDoc) {
      this.logger.error(
        'Design doc not found while building next-level agent input',
        {
          designDocId: context.designDocId,
          organizationId: context.core.organizationId,
        },
      );
      return undefined;
    }

    const target = this.getGenerationTarget(
      designDoc.status as AdrStatus | undefined,
    );

    if (!target) {
      this.logger.warn(
        'Next-level generation requested without a generating status',
        {
          designDocId: designDoc.id,
          status: designDoc.status,
        },
      );
      return undefined;
    }

    const lastUserMessage = `We need a first draft of ${target.label}, fenerate initial content based on the existing ADR sections. Focus exclusively on writing the draft of ${target.label} section and produce polished markdown.`;

    const input: AdrRefinerAgentInput = {
      adr: {
        title: designDoc.name || 'ADR',
        context: this.getSectionContent(designDoc, 'context'),
        decision: this.getSectionContent(designDoc, 'decision'),
        consequences: this.getSectionContent(designDoc, 'consequences'),
      },
      lastUserMessage,
      activeSection: target.sectionKey as AdrActiveSectionEnum,
      initiative: undefined,
      task: undefined,
      requiredOps: 1,
    };

    const validation = AdrRefinerAgentInputSchema.safeParse(input);
    if (!validation.success) {
      this.logger.warn('ADR next-level input validation failed', {
        issues: validation.error.issues,
        designDocId: designDoc.id,
      });
      return undefined;
    }

    return validation.data as AdrRefinerAgentInput;
  };

  async buildContext(
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      designDocId: context.designDocId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
    };
  }

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AdrAgentResponse>,
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    try {
      const context = tracker.getContext();
      const designDoc = await this.designDocService.findOneForAdapter(
        context.designDocId,
        context.core.organizationId,
      );

      if (!designDoc) {
        throw new Error(
          `Design document ${context.designDocId} not found for generation`,
        );
      }

      const generationTarget = this.getGenerationTarget(
        designDoc.status as AdrStatus | undefined,
      );

      if (!generationTarget) {
        this.logger.warn(
          'No generation target detected, skipping next-level node',
          {
            designDocId: designDoc.id,
            status: designDoc.status,
          },
        );
        return {
          nextNodeId: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
          errorMsg: 'No generation target detected, skipping next-level node',
        };
      }

      if (!agentResponse.result) {
        this.logger.error(
          'ADR next-level agent response missing result field',
          {
            executionId: agentResponse.executionId,
            status: agentResponse.status,
          },
        );
        return {
          nextNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'ADR next-level agent response missing result field',
        };
      }

      const parseResult = AdrAgentResponseSchema.safeParse(
        agentResponse.result.data,
      );

      if (!parseResult.success) {
        this.logger.error('ADR next-level response validation failed', {
          executionId: agentResponse.executionId,
          error: parseResult.error,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'ADR next-level response validation failed',
        };
      }

      const agentData = parseResult.data;
      if (!agentData.ops?.length) {
        this.logger.warn('ADR next-level agent returned no operations', {
          executionId: agentResponse.executionId,
          designDocId: designDoc.id,
        });
        return {
          nextNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg: 'ADR next-level agent returned no operations',
        };
      }

      const sectionChange = agentData.ops.find(
        (op) => op.target === generationTarget.sectionKey,
      );

      if (!sectionChange) {
        this.logger.warn(
          'ADR next-level agent response did not include target section update',
          {
            executionId: agentResponse.executionId,
            targetSection: generationTarget.sectionKey,
          },
        );
        return {
          nextNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          errorMsg:
            'ADR next-level agent response did not include target section update',
        };
      }

      await this.designDocService.applySectionUpdates(
        designDoc.id as DesignDocId,
        context.core.organizationId,
        [{ key: generationTarget.sectionKey, content: sectionChange.text }],
      );

      await this.designDocService.update(
        designDoc.id,
        { status: generationTarget.completedStatus },
        context.core.organizationId,
      );

      const responseFieldId = uuidv4();
      const uiElement: UIElement = {
        id: responseFieldId,
        type: ExtendedUIFieldType.AgentResponse,
        label: `Generated ${generationTarget.label} content`,
        placeholder: 'Review the generated draft...',
        required: false,
        influences: (agentData.influences || []) as Influence[],
      };

      const secondaryActions = buildRelatedEntitiesSecondaryActions({
        fieldId: responseFieldId,
        relatedEntities: agentData.relatedEntities,
      });

      return {
        nextNodeId: ADR_REFINEMENT_NODES.AGENT_ANALYSIS,
        systemMessageData: {
          ragEnabled: false,
          type: 'QUESTIONS',
          response:
            agentData.response ||
            `I generated a ${generationTarget.label.toLowerCase()} section for the ADR.`,
          title: `Generated ${generationTarget.label} draft`,
          ...(secondaryActions.length ? { secondaryActions } : {}),
          uiElements: [uiElement],
        },
      };
    } catch (error) {
      this.logger.error('Error processing ADR next-level agent response', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        nextNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        errorMsg: 'Error processing ADR next-level agent response',
      };
    }
  }

  async compensate(
    _context: AdrRefinementFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 5000;
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `ADR next-level agent timeout, retry ${attemptCount + 1}/3 after ${delay}ms`,
      };
    }

    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'ADR next-level agent retryable error',
      };
    }

    return { action: 'FAIL' };
  }

  private getGenerationTarget(status?: AdrStatus): GenerationTarget | null {
    switch (status) {
      case AdrStatus.AdrGeneratingDecision:
        return {
          sectionKey: 'decision',
          completedStatus: AdrStatus.AdrDecision,
          label: 'Decision',
        };
      case AdrStatus.AdrGeneratingConsequences:
        return {
          sectionKey: 'consequences',
          completedStatus: AdrStatus.AdrConsequences,
          label: 'Consequences',
        };
      default:
        return null;
    }
  }

  private getSectionContent(
    designDoc: Awaited<ReturnType<DesignDocService['findOneForAdapter']>>,
    key: string,
  ): string {
    const section = designDoc?.sections?.find((s) => s.key === key);
    return section?.materializedMarkdown ?? '';
  }
}
