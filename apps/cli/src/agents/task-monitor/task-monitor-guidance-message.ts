import { UserMessageDataCodingFreeformAllOfPromptTypeEnum as UserMessageDataCodingFreeformPromptTypeEnum } from '@hey-hey/contracts/api/models';
import {
  MessageStatus,
  MessageType,
  UserMessageAgentInputProvenance,
  type UserMessageDataCodingFreeform,
} from '@hey-hey/contracts/api/models';
import type { MessagePoster } from '../../run/message-poster';
import type { CreateMessageBody } from '../../run/types';
import { toOpenApiProjectId } from '../../shared/api/identifierAdapters';

export interface PostTaskMonitorGuidanceMessageArgs {
  poster: MessagePoster;
  organizationId: string;
  projectId: string;
  conversationId: string;
  userId: string;
  guidance: string;
}

export const postTaskMonitorGuidanceMessage = async (
  args: PostTaskMonitorGuidanceMessageArgs,
): Promise<string> => {
  const agentInput = {
    promptType: UserMessageDataCodingFreeformPromptTypeEnum.CodingFreeform,
    userMessage: args.guidance,
    provenance: UserMessageAgentInputProvenance.TaskMonitor,
  } satisfies UserMessageDataCodingFreeform;

  const dto: CreateMessageBody = {
    type: MessageType.User,
    userId: args.userId,
    status: MessageStatus.Completed,
    projectId: toOpenApiProjectId(args.projectId),
    data: { agentInput },
    createdAt: new Date().toISOString(),
  };

  return args.poster.createOutOfBand({
    organizationId: args.organizationId,
    projectId: args.projectId,
    conversationId: args.conversationId,
    dto,
    stamp: null,
  });
};
