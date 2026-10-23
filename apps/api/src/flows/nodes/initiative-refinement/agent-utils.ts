import { Logger } from '@nestjs/common';
import {
  ArtifactType,
  InitiativeResponseDto,
  MaterializedWorkItemSection,
  QAPairData,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeRefinementFlowContext } from 'src/types/flow-internal.types';
import { formatArtifactForPrompt } from 'src/utils/artifact-formatting.util';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import { getCurrentSectionFromStatus } from 'src/utils/work-item.util';
import {
  InitiativeRefinerRequest,
  InitiativeRefinerRequestSchema,
} from './types';
import { InitiativeActiveSectionEnum } from 'src/generated/agents/models';

const requireField = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing required field: ${label}`);
  }
  return value;
};

export const getCommonAgentInput = async (
  context: InitiativeRefinementFlowContext,
  lastUserMessage: {
    content?: string;
    id?: string;
  },
  initiative: Pick<InitiativeResponseDto, 'status' | 'name'> & {
    sections?: MaterializedWorkItemSection[] | null;
  },
  artifactService: ArtifactService,
  logger: Logger,
  {
    requiredOps,
  }: {
    requiredOps?: number;
  } = {},
): Promise<InitiativeRefinerRequest | undefined> => {
  try {
    if (!initiative) {
      logger.error('Initiative not found while building agent input', {
        initiativeId: context.initiativeId,
        organizationId: context.core.organizationId,
      });
      throw new Error(
        `Initiative not found while building agent input ${context.initiativeId}`,
      );
    }

    if (lastUserMessage.content === undefined) {
      logger.error('latestUserMessage not found while building agent input', {
        workflowId: context.core.workflowId,
        organizationId: context.core.organizationId,
      });
      throw new Error(`latestUserMessage not found while building agent input`);
    }

    // Determine active section from status
    const statusLevel = getCurrentSectionFromStatus(
      initiative.status || 'REFINING_DESCRIPTION',
    ) as InitiativeActiveSectionEnum;

    // Fetch recent conversation messages (excluding current user message)
    let recentConversationMessages:
      | Array<{ id: string; content: string; role?: string }>
      | undefined;

    try {
      const artifacts = await artifactService.findMany(
        {
          projectId: context.core.projectId,
          sourceId: String(context.core.conversationId),
          status: 'ACTIVE',
          limit: 3,
          type: ArtifactType.QaPair,
          orderBy: 'createdAt',
          orderDirection: 'desc',
        },
        context.core.organizationId,
      );

      const conversationEntries: Array<{
        id: string;
        content: string;
        role?: string;
      }> = [];

      for (const artifact of artifacts?.data ?? []) {
        const data = artifact.data as QAPairData | undefined;
        if (!data || data.type !== 'QA_PAIR') {
          continue;
        }
        if (data.userMessageId === lastUserMessage?.id) {
          continue;
        }
        const content = formatArtifactForPrompt(artifact, {
          includeTitle: false,
          includeContentHeader: false,
          includeType: false,
          includeTimestamp: false,
        });

        conversationEntries.push({
          id: artifact.id,
          content,
        });
      }

      recentConversationMessages = conversationEntries.length
        ? conversationEntries.slice(0, 3)
        : undefined;
    } catch (error) {
      logger.warn('Failed to fetch recent conversation messages', {
        conversationId: context.core.conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue without recent messages if fetch fails
      recentConversationMessages = undefined;
    }

    const sectionContent = materializedSectionsToContentMap(
      initiative.sections ?? undefined,
    );

    const input: InitiativeRefinerRequest = {
      initiative: {
        title: requireField(initiative.name, 'initiative.name'),
        description: sectionContent.description,
        details: sectionContent.details,
        acceptanceCriteria: sectionContent.acceptanceCriteria,
      },
      lastUserMessage: lastUserMessage.content,
      activeSection: statusLevel,
      recentConversationMessages,
      requiredOps: requiredOps ?? 0,
    };

    const validation = InitiativeRefinerRequestSchema.safeParse(input);

    if (!validation.success) {
      const issues = validation.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      logger.warn('Initiative refiner input validation failed', {
        initiativeId: context.initiativeId,
        issues,
      });
      throw new Error(
        `Initiative refiner input validation failed: ${JSON.stringify(issues)}`,
      );
    }

    return validation.data;
  } catch (error) {
    logger.error('Failed to build initiative refiner input', {
      error: error instanceof Error ? error.message : 'Unknown error',
      initiativeId: context.initiativeId,
    });
    throw error;
  }
};
