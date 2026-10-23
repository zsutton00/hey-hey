import { MessageStatus } from 'src/constants/message-status.constants';
import {
  MessageResponseDto,
  ProposalResponseDto,
  MessageRecordDto,
  SystemMessageData,
} from 'src/generated';
import { MessageQueryResult } from 'src/services/types';
import { MessageId, UserId, WorkflowId } from 'src/types';
import { MessageResponseUtil } from 'src/utils/message-response.util';

/**
 * Maps a timeline message. Timeline reads exclude undated rows (queued inputs
 * the agent has not started), so a null `createdAt` here is a broken read.
 */
export function prismaMessageResultToResponseDto(
  result: MessageQueryResult,
  conversationWorkflowId?: WorkflowId,
  proposalDtosById: ReadonlyMap<string, ProposalResponseDto> = new Map(),
): MessageResponseDto {
  if (!result.createdAt) {
    throw new Error(
      `Message ${result.id} has no createdAt; undated queued inputs are not timeline messages`,
    );
  }
  return mapMessage(
    result,
    result.createdAt.toISOString(),
    conversationWorkflowId,
    proposalDtosById,
  ) as MessageResponseDto;
}

/**
 * Maps a message read by identity or from the input queue; a queued input the
 * agent has not started has a null `createdAt`.
 */
export function prismaMessageResultToMessageRecordDto(
  result: MessageQueryResult,
  conversationWorkflowId?: WorkflowId,
  proposalDtosById: ReadonlyMap<string, ProposalResponseDto> = new Map(),
): MessageRecordDto {
  return mapMessage(
    result,
    result.createdAt?.toISOString() ?? null,
    conversationWorkflowId,
    proposalDtosById,
  ) as MessageRecordDto;
}

function mapMessage(
  result: MessageQueryResult,
  createdAt: string | null,
  conversationWorkflowId: WorkflowId | undefined,
  proposalDtosById: ReadonlyMap<string, ProposalResponseDto>,
): MessageResponseDto | MessageRecordDto {
  const resolvedWorkflowId =
    conversationWorkflowId ?? result.conversation?.workflowId ?? undefined;

  const baseMessage = {
    ...(result.executionStatus
      ? {
          executionStatus: result.executionStatus,
          executionAdmissionDisposition:
            result.executionAdmissionDisposition ?? 'PENDING',
          executionQueueConfirmed:
            result.executionStatus === 'queued' &&
            (result.executionAdmissionDisposition === 'QUEUED' ||
              !!result.executionAdmissionId),
          executionCancellationRequested:
            result.executionCancellationRequested ?? false,
          ...(result.executionOperationId
            ? { executionOperationId: result.executionOperationId }
            : {}),
        }
      : {}),
    id: result.id as MessageId,
    projectId: result.projectId,
    status: result.status as MessageStatus,
    userId: result.userId,
    data: result.data,
    conversationId: result.conversationId,
    parentMessageId: result.parentMessageId,
    createdAt,
    responses:
      result.responses?.map((response) =>
        prismaMessageResultToResponseDto(
          response,
          resolvedWorkflowId as WorkflowId,
          proposalDtosById,
        ),
      ) || [],
    parentMessage: result.parentMessage
      ? prismaMessageResultToResponseDto(
          result.parentMessage,
          resolvedWorkflowId as WorkflowId,
          proposalDtosById,
        )
      : undefined,
    ...(result.proposals && result.status === MessageStatus.Completed
      ? {
          proposals: result.proposals.map((proposal) => {
            const dto = proposalDtosById.get(proposal.id);
            if (!dto) {
              throw new Error(
                `Missing API-owned approval state for proposal ${proposal.id}`,
              );
            }
            return dto;
          }),
        }
      : {}),
  };

  // Create discriminated union based on type
  if (result.type === 'SYSTEM') {
    const systemData: SystemMessageData =
      (result.data as SystemMessageData) || {
        detectedIntent: '',
        intentConfidence: 0,
        type: 'NOOP',
        response: '',
      };

    return {
      ...baseMessage,
      type: 'SYSTEM' as const,
      data: systemData,
      awaitingResponse: MessageResponseUtil.isAwaitingResponse(
        result.responses,
        systemData,
        result.status as MessageStatus,
      ),
    } as unknown as MessageResponseDto;
  }
  return {
    ...baseMessage,
    type: 'USER' as const,
    data: result.data || {},
    user: result.user
      ? {
          id: result.user.id as UserId,
          email: result.user.email,
          name: result.user.name,
          isActive: result.user.isActive,
          lastLoginAt: result.user.lastLoginAt?.toISOString() ?? null,
          createdAt: result.user.createdAt.toISOString(),
          updatedAt: result.user.updatedAt.toISOString(),
          currentOrganizationId: null,
        }
      : undefined,
  } as unknown as MessageResponseDto;
}

/** A message record that is in the conversation timeline (dated). */
export function isTimelineMessage<T extends MessageRecordDto>(
  message: T,
): message is Extract<T, MessageRecordDto> & MessageResponseDto {
  return message.createdAt !== null;
}
