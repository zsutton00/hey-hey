import {
  MessageStatus,
  MessageType,
  UserMessageAgentInputProvenance,
  UserMessageDataCodingFreeformPromptTypeEnum,
  type UserMessageDataCodingFreeform,
} from '../../shared/api/generated/api';
import type { MessagePoster } from '../../run/message-poster';
import type { CreateMessageBody } from '../../run/types';

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
    projectId: args.projectId,
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
