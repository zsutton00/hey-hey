import { z } from 'zod/v4';
import type { CodexSdkEvent, CodexSdkRootTurnIdentity } from '@hey-hey/ui-common/agents';
import { ExecutionCaptureSession } from '../execution-recorder/capture-session';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import type { ServerLogger } from '../../../server/logger';

const startedSchema = z.object({
  method: z.literal('item/started'),
  params: z.object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    item: z.object({ id: z.string().min(1), type: z.enum(['commandExecution', 'fileChange']) }),
  }),
});
const completedSchema = z.object({
  method: z.literal('item/completed'),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    item: z.object({
      id: z.string(),
      type: z.enum(['commandExecution', 'fileChange']),
      status: z.string(),
      exitCode: z.number().nullable().optional(),
    }),
  }),
});

export class CodexExecutionCaptureHooks {
  public readonly session: ExecutionCaptureSession;
  public constructor(recorder: ExecutionRecorder, logger: ServerLogger) {
    this.session = new ExecutionCaptureSession('codex', recorder, logger);
  }
  public observe(event: CodexSdkEvent, root: CodexSdkRootTurnIdentity | null): void {
    if (root) this.session.bindProviderTurn(root.threadId, root.turnId);
    const completed = completedSchema.safeParse(event);
    if (
      completed.success &&
      root &&
      completed.data.params.threadId === root.threadId &&
      completed.data.params.turnId === root.turnId
    ) {
      const { threadId, item } = completed.data.params;
      if (item.status === 'declined') this.session.outcome(threadId, item.id, 'denied');
      else if (
        item.status === 'failed' ||
        (item.exitCode !== undefined && item.exitCode !== null && item.exitCode !== 0)
      )
        this.session.outcome(threadId, item.id, 'failure');
      else if (item.status === 'completed') this.session.outcome(threadId, item.id, 'success');
    }
    const result = startedSchema.safeParse(event);
    if (!result.success || !root) return;
    const { threadId, turnId, item } = result.data.params;
    if (threadId !== root.threadId || turnId !== root.turnId) return;
    this.session.admit(
      threadId,
      turnId,
      item.id,
      item.type === 'commandExecution' ? 'Bash' : 'apply_patch',
    );
  }
}
