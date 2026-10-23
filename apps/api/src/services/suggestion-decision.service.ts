import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GOAL_PM_ROUTING_DECISION_TYPE } from './goal-pm-routing-decision.service';
import { SuggestionDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SuggestionType } from '../generated';
import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  TaskId,
  UserId,
  WorkflowId,
} from '../types';

export type SuggestionDecisionMetadata =
  | CreateSuggestedTaskDecisionMetadata
  | CreateSuggestedDesignDocDecisionMetadata
  | ProposedInitiativeDecisionMetadata;

export interface CreateSuggestedTaskDecisionMetadata {
  kind: 'CREATE_SUGGESTED_TASK';
  workflowId?: WorkflowId;
  taskId?: TaskId;
}

export interface CreateSuggestedDesignDocDecisionMetadata {
  kind: 'CREATE_SUGGESTED_DESIGN_DOC';
  workflowId?: WorkflowId;
  designDocId?: string;
}

export interface ProposedInitiativeDecisionMetadata {
  kind: 'PROPOSED_INITIATIVE';
  initiativeId: InitiativeId;
}

export interface SuggestionDecisionResult {
  id: string;
  type: SuggestionType;
  accepted: boolean | null;
  decidedBy: UserId | null;
  sourceConversationId: ConversationId | null;
  sourceMessageId: MessageId | null;
  metadata: SuggestionDecisionMetadata | null;
  createdAt: Date | null;
}

export interface RecordSuggestionDecisionInput {
  organizationId: OrganizationId;
  suggestionId: string;
  type: SuggestionType;
  accepted: boolean;
  decidedBy?: UserId;
  sourceConversationId?: ConversationId | null;
  sourceMessageId?: MessageId | null;
  metadata?: SuggestionDecisionMetadata | null;
}

export interface ListSuggestionDecisionsInput {
  organizationId: OrganizationId;
  sourceConversationId?: ConversationId;
  sourceMessageId?: MessageId;
}

@Injectable()
export class SuggestionDecisionService {
  private readonly logger = new Logger(SuggestionDecisionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDecision(
    organizationId: OrganizationId,
    type: SuggestionType,
    suggestionId: string,
  ): Promise<SuggestionDecisionResult> {
    const normalizedType = type.trim();
    if (normalizedType === GOAL_PM_ROUTING_DECISION_TYPE) throw new BadRequestException('Use conversation routing decision history');
    const normalizedId = suggestionId.trim();

    const decision = await this.prisma.db.suggestionDecision.findUnique({
      where: {
        organizationId_type_suggestionId: {
          organizationId,
          type: normalizedType,
          suggestionId: normalizedId,
        },
      },
    });

    return this.mapDecision(
      decision,
      normalizedType as SuggestionType,
      normalizedId,
    );
  }

  async recordDecision(
    input: RecordSuggestionDecisionInput,
  ): Promise<SuggestionDecisionResult> {
    const normalizedType = input.type.trim();
    if (normalizedType === GOAL_PM_ROUTING_DECISION_TYPE) throw new BadRequestException('Use the dedicated routing decision operation');
    const normalizedId = input.suggestionId.trim();

    const createData = {
      organizationId: input.organizationId,
      type: normalizedType,
      suggestionId: normalizedId,
      accepted: input.accepted,
      decidedBy: input.decidedBy ?? null,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      metadata: input.metadata ?? null,
    };

    const updateData: {
      accepted: boolean;
      decidedBy: UserId | null;
      sourceConversationId?: ConversationId | null;
      sourceMessageId?: MessageId | null;
      metadata?: SuggestionDecisionMetadata | null;
    } = {
      accepted: input.accepted,
      decidedBy: input.decidedBy ?? null,
    };

    if (input.sourceConversationId !== undefined) {
      updateData.sourceConversationId = input.sourceConversationId;
    }

    if (input.sourceMessageId !== undefined) {
      updateData.sourceMessageId = input.sourceMessageId;
    }

    if (input.metadata !== undefined) {
      updateData.metadata = input.metadata;
    }

    type Args = Parameters<typeof this.prisma.db.suggestionDecision.upsert>[0];
    type CreateArgs = Args['create'];
    type UpdateArgs = Args['update'];
    const decision = await this.prisma.db.suggestionDecision.upsert({
      where: {
        organizationId_type_suggestionId: {
          organizationId: input.organizationId,
          type: normalizedType,
          suggestionId: normalizedId,
        },
      },
      create: createData as CreateArgs,
      update: updateData as UpdateArgs,
    });

    this.logger.debug('Recorded suggestion decision', {
      organizationId: input.organizationId,
      type: normalizedType,
      suggestionId: normalizedId,
      accepted: input.accepted,
    });

    return this.mapDecision(
      decision,
      normalizedType as SuggestionType,
      normalizedId,
    );
  }

  async listDecisions(
    input: ListSuggestionDecisionsInput,
  ): Promise<SuggestionDecisionResult[]> {
    const decisions = await this.prisma.db.suggestionDecision.findMany({
      where: {
        organizationId: input.organizationId,
        type: { not: GOAL_PM_ROUTING_DECISION_TYPE },
        ...(input.sourceConversationId
          ? { sourceConversationId: input.sourceConversationId }
          : {}),
        ...(input.sourceMessageId
          ? { sourceMessageId: input.sourceMessageId }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { suggestionId: 'asc' }],
    });

    return decisions.map((decision) => this.mapStoredDecision(decision));
  }

  private mapDecision(
    decision: SuggestionDecision | null,
    type: SuggestionType,
    suggestionId: string,
  ): SuggestionDecisionResult {
    if (!decision) {
      return {
        id: suggestionId,
        type,
        accepted: null,
        decidedBy: null,
        sourceConversationId: null,
        sourceMessageId: null,
        metadata: null,
        createdAt: null,
      };
    }

    return {
      id: decision.suggestionId,
      type: decision.type as SuggestionType,
      accepted: decision.accepted,
      decidedBy: decision.decidedBy as UserId | null,
      sourceConversationId:
        decision.sourceConversationId as ConversationId | null,
      sourceMessageId: decision.sourceMessageId as MessageId | null,
      metadata: decision.metadata as SuggestionDecisionMetadata | null,
      createdAt: decision.createdAt,
    };
  }

  private mapStoredDecision(
    decision: SuggestionDecision,
  ): SuggestionDecisionResult {
    return {
      id: decision.suggestionId,
      type: decision.type as SuggestionType,
      accepted: decision.accepted,
      decidedBy: decision.decidedBy as UserId | null,
      sourceConversationId:
        decision.sourceConversationId as ConversationId | null,
      sourceMessageId: decision.sourceMessageId as MessageId | null,
      metadata: decision.metadata as SuggestionDecisionMetadata | null,
      createdAt: decision.createdAt,
    };
  }
}
