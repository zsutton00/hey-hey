import { z } from 'zod/v4';
import type { ClaudeCodeSdkEvent } from '../../../agent-runtime/index';
import { ExecutionCaptureSession } from '../execution-recorder/capture-session';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import type { ServerLogger } from '../../../server/logger';

const assistantSchema = z.object({
  type: z.literal('assistant'),
  session_id: z.string().min(1),
  parent_tool_use_id: z.string().nullable().optional(),
  message: z.object({
    content: z.array(
      z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }),
    ),
  }),
});
const supportedTools = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const denialSchema = z.object({
  type: z.literal('result'),
  session_id: z.string().min(1),
  permission_denials: z.array(z.object({ tool_use_id: z.string().min(1) })),
});
const failedResultSchema = z.object({
  type: z.literal('user'),
  session_id: z.string().min(1),
  parent_tool_use_id: z.string().nullable().optional(),
  message: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        tool_use_id: z.string().optional(),
        is_error: z.boolean().optional(),
      }),
    ),
  }),
});

export class ClaudeExecutionCaptureHooks {
  public readonly session: ExecutionCaptureSession;
  public constructor(recorder: ExecutionRecorder, logger: ServerLogger) {
    this.session = new ExecutionCaptureSession('claude', recorder, logger);
  }
  public observe(event: ClaudeCodeSdkEvent): void {
    const denial = denialSchema.safeParse(event);
    if (denial.success)
      for (const item of denial.data.permission_denials)
        this.session.outcome(denial.data.session_id, item.tool_use_id, 'denied');
    const failed = failedResultSchema.safeParse(event);
    if (failed.success && !failed.data.parent_tool_use_id)
      for (const item of failed.data.message.content) {
        if (item.type === 'tool_result' && item.is_error && item.tool_use_id)
          this.session.outcome(failed.data.session_id, item.tool_use_id, 'failure');
      }
    const result = assistantSchema.safeParse(event);
    if (!result.success || result.data.parent_tool_use_id) return;
    for (const block of result.data.message.content) {
      if (block.type !== 'tool_use' || !block.id || !block.name || !supportedTools.has(block.name))
        continue;
      this.session.admit(result.data.session_id, null, block.id, block.name);
    }
  }
}
