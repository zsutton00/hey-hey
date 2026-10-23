import type { Prisma } from '@prisma/client';

/**
 * Rows in the conversation timeline. A queued executable input has no
 * `createdAt` until the platform accepts the agent's start of it, and every
 * timeline or "latest" read must exclude it: Postgres sorts NULLs first in
 * DESC and last in ASC, so an unfiltered read leaks queued rows.
 */
export const TIMELINE_MESSAGE_WHERE = {
  createdAt: { not: null },
} satisfies Prisma.MessageWhereInput;

/** `createdAt` of a row read through TIMELINE_MESSAGE_WHERE. */
export function timelineCreatedAt(message: {
  id: string;
  createdAt: Date | null;
}): Date {
  if (!message.createdAt) {
    throw new Error(
      `Message ${message.id} is not in the conversation timeline`,
    );
  }
  return message.createdAt;
}
