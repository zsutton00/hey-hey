import { z } from 'zod';
import { ConflictException, Logger } from '@nestjs/common';

import {
  CodingPlanVersionSchema,
  CodingPlanDiscrepancySchema,
} from 'src/generated/workflow-review.schemas';
import type { Prisma } from '@prisma/client';
import type { MessageResponseDto } from 'src/generated';
import { TIMELINE_MESSAGE_WHERE } from 'src/utils/message-timeline.util';

const logger = new Logger('CodingPlanReview');

const planningMessageData = z
  .object({
    comment: z.string().optional(),
    response: z.string().optional(),
    agentInput: z
      .object({ userMessage: z.string().optional() })
      .passthrough()
      .optional(),
    uiElements: z
      .array(
        z
          .object({ type: z.string(), payload: z.unknown().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** Resolve the reviewed persisted context, never browser-supplied replacement prose. */
export function codingPlanMessagesQuery(
  organizationId: string,
  projectId: string,
  conversationId: string,
) {
  return {
    where: {
      ...TIMELINE_MESSAGE_WHERE,
      projectId,
      conversationId,
      conversation: { organizationId },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, data: true, parentMessageId: true },
  } satisfies Prisma.MessageFindManyArgs;
}

export function resolveReviewedCodingPlan(
  rows: readonly (Pick<MessageResponseDto, 'id' | 'type' | 'data'> & {
    parentMessageId?: MessageResponseDto['id'] | null;
  })[],
  versionMessageId: string,
  approvalEvidenceMessageId?: string,
) {
  let latest: {
    messageId: string;
    context: ReturnType<typeof CodingPlanVersionSchema.safeParse>;
  } | null = null;
  const discussion: string[] = [];
  let unreviewedReply = false;
  for (const row of rows) {
    const parsed = planningMessageData.safeParse(row.data);
    if (!parsed.success) continue;
    const data = parsed.data;
    if (row.type === 'USER') {
      // Workflow evidence is not a new planning reply; approval feedback travels separately.
      if (row.id === approvalEvidenceMessageId) continue;
      const text =
        data.agentInput?.userMessage ?? data.comment ?? data.response;
      if (text) {
        discussion.push(
          `User (${row.id}${row.parentMessageId ? `, reply to ${row.parentMessageId}` : ''}): ${text}`,
        );
        unreviewedReply = true;
      }
    }
    if (row.type !== 'SYSTEM') continue;
    if (data.response) discussion.push(`Planner (${row.id}): ${data.response}`);
    for (const element of data.uiElements ?? []) {
      if (element.type === 'coding_plan_version') {
        latest = {
          messageId: row.id,
          context: CodingPlanVersionSchema.safeParse(element.payload),
        };
        unreviewedReply = false;
        if (latest.context.success)
          discussion.push(`Plan (${row.id}): ${latest.context.data.markdown}`);
      } else if (element.type === 'coding_plan_discrepancy') {
        const issue = CodingPlanDiscrepancySchema.safeParse(element.payload);
        discussion.push(
          issue.success
            ? `Issue (${row.id}): ${JSON.stringify(issue.data)}`
            : `Issue (${row.id}) is unavailable because its persisted evidence is invalid.`,
        );
      }
    }
  }
  if (!latest || latest.messageId !== versionMessageId || unreviewedReply) {
    logger.debug('Coding Plan version rejected as stale', {
      versionMessageId,
      currentVersionMessageId: latest?.messageId,
      unreviewedReply,
    });
    throw new ConflictException({
      code: 'CODING_PLAN_REVIEW_CONTEXT_STALE',
      message:
        'The reviewed planning context is missing or has changed. Review the latest discussion before approving.',
    });
  }
  if (!latest.context.success) {
    logger.debug('Coding Plan version rejected as invalid', {
      versionMessageId,
    });
    throw new ConflictException({
      code: 'CODING_PLAN_REVIEW_CONTEXT_INVALID',
      message:
        'The reviewed planning context is invalid and must be corrected before approval.',
    });
  }
  logger.debug('Coding Plan current complete version resolved', {
    versionMessageId,
  });
  return {
    versionMessageId: latest.messageId,
    approvedVersion: latest.context.data,
    planningDiscussion: discussion.join('\n\n'),
  };
}

export function hasCodingPlanVersion(
  rows: readonly Pick<MessageResponseDto, 'type' | 'data'>[],
): boolean {
  return rows.some((row) => {
    if (row.type !== 'SYSTEM') return false;
    const parsed = planningMessageData.safeParse(row.data);
    return (
      parsed.success &&
      parsed.data.uiElements?.some(
        (element) =>
          element.type === 'coding_plan_version' ||
          element.type === 'coding_plan_context',
      ) === true
    );
  });
}
