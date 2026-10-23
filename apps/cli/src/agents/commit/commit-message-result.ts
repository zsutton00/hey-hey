import { z } from 'zod';

import type { PassThroughSubmissionToolDeclaration } from '../submission-tools/types';

const commitMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(72)
  .refine((message) => !message.includes('\n'), 'Commit message must be a single line')
  .refine(
    (message) => !/^(Task-Id|Plan-Id|Coding-Session-Id|Service-Id):/imu.test(message),
    'Commit message must not contain runtime-owned trailers',
  );

export class CommitMessageResultStore {
  private readonly messages = new Map<string, string>();

  public readonly tool: PassThroughSubmissionToolDeclaration = {
    kind: 'pass_through',
    name: 'submit_commit_message',
    description:
      'Submit the concise conventional-commit message. The runtime validates scope, stages, commits, adds trailers, and emits the COMMIT report.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: {
          type: 'string',
          minLength: 1,
          maxLength: 72,
          description: 'Single-line conventional-commit message without trailers.',
        },
      },
      required: ['message'],
    },
    execute: (ctx) => {
      const parsed = commitMessageSchema.safeParse(ctx.args['message']);
      if (!parsed.success) {
        throw new Error(
          `submit_commit_message: ${parsed.error.issues[0]?.message ?? 'invalid message'}`,
        );
      }
      if (this.messages.has(ctx.runId)) {
        throw new Error('submit_commit_message: a message was already submitted for this turn');
      }
      this.messages.set(ctx.runId, parsed.data);
      return { content: [{ type: 'text', text: 'Commit message accepted.' }] };
    },
  };

  public consume(runId: string): string | null {
    const message = this.messages.get(runId) ?? null;
    this.messages.delete(runId);
    return message;
  }
}
