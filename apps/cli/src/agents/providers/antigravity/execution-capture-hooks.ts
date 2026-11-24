import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ToolExecutionCommandHook,
  ToolExecutionHookLaunch,
} from '../../../agent-runtime/index';
import {
  ANTIGRAVITY_HOOK_MATCHER,
  antigravityToolClass,
  ExecutionCaptureSession,
} from '../execution-recorder/capture-session';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import { quoteShell } from '../execution-recorder/hook-command';
import type { ServerLogger } from '../../../server/logger';
import type { AcpInboundCall } from './acp-schemas';

type SessionUpdate = Extract<AcpInboundCall, { method: 'session/update' }>['params'];

/** ACP tool kinds that can change files. One the capture table does not cover is a stated gap. */
const FILE_CHANGING_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/** agy runs hooks for at most this long; the relay itself gives up after 2.5 seconds. */
const HOOK_TIMEOUT_SECONDS = 30;

/**
 * agy's hooks.json: each top-level key names a hook. The channel address and token are part of
 * the command, so they reach the relay whatever environment agy and its sandbox pass to hooks.
 */
export const antigravityHookSettings = (
  launch: ToolExecutionHookLaunch,
): Record<string, Record<'PreToolUse' | 'PostToolUse', ToolExecutionCommandHook[]>> => {
  const { HEY_HEY_CAPTURE_URL, HEY_HEY_CAPTURE_TOKEN } = launch.environment;
  const command = [
    `HEY_HEY_CAPTURE_URL=${quoteShell(HEY_HEY_CAPTURE_URL)}`,
    `HEY_HEY_CAPTURE_TOKEN=${quoteShell(HEY_HEY_CAPTURE_TOKEN)}`,
    launch.command,
  ].join(' ');
  const group: ToolExecutionCommandHook = {
    matcher: ANTIGRAVITY_HOOK_MATCHER,
    hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }],
  };
  return { 'hey-hey-capture': { PreToolUse: [group], PostToolUse: [group] } };
};

/**
 * Antigravity's side of execution capture. Tool identity comes only from the ACP event stream:
 * agy's hook `toolCall.id` is the ACP `toolCallId` (confirmed by the hook-relay recording), so a
 * hook pairs only with the tool call of that exact id, and any other hook is an identity gap.
 */
export class AntigravityExecutionCaptureHooks {
  public readonly session: ExecutionCaptureSession;
  private readonly deniedTools = new Set<string>();

  public constructor(
    recorder: ExecutionRecorder,
    private readonly logger: ServerLogger,
  ) {
    this.session = new ExecutionCaptureSession('antigravity', recorder, logger);
  }

  /**
   * Writes the hook file agy reads from its launch directory, which is private to the Run and
   * never a repository. Without a launch, any earlier file is removed so no hook outlives capture.
   *
   * Precise tracking is optional: when the file cannot be written, the cause is recorded, any
   * partial or earlier file is removed, and the session runs with approximate tracking. Only a
   * hook file that can be neither written nor removed stops the launch, because agy would then
   * run hooks this capture does not own.
   */
  public async install(
    launchDirectory: string,
    launch: ToolExecutionHookLaunch | undefined,
  ): Promise<void> {
    const file = path.join(launchDirectory, '.agents', 'hooks.json');
    if (!launch) {
      await this.remove(file);
      return;
    }
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(antigravityHookSettings(launch)), { mode: 0o600 });
    } catch (error) {
      this.logger.warn('execution_capture.antigravity_hooks_install_failed', {
        file,
        code: (error as NodeJS.ErrnoException).code,
        cause: error instanceof Error ? error.message : String(error),
      });
      await this.remove(file);
      await this.session.hooksUnavailable(error);
      return;
    }
    this.logger.debug('execution_capture.antigravity_hooks_installed', {
      file,
      matcher: ANTIGRAVITY_HOOK_MATCHER,
    });
  }

  private async remove(file: string): Promise<void> {
    try {
      await rm(file, { force: true });
    } catch (error) {
      this.logger.warn('execution_capture.antigravity_hooks_remove_failed', {
        file,
        code: (error as NodeJS.ErrnoException).code,
        cause: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public observe({ sessionId, update }: SessionUpdate): void {
    if (update.sessionUpdate === 'tool_call') {
      const toolName = update.name;
      if (toolName && antigravityToolClass(toolName)) {
        this.session.admit(sessionId, null, update.toolCallId, toolName);
        return;
      }
      if (update.kind && FILE_CHANGING_KINDS.has(update.kind)) {
        this.logger.debug('execution_capture.antigravity_tool_unsupported', {
          toolName,
          kind: update.kind,
          toolCallId: update.toolCallId,
        });
        void this.session.unsupportedTool();
      }
      return;
    }

    if (update.sessionUpdate !== 'tool_call_update' || update.status !== 'failed') {
      return;
    }

    // agy reports a rejected call as failed too; the runner's own rejection says it was denied.
    if (!this.deniedTools.has(`${sessionId}:${update.toolCallId}`)) {
      this.session.outcome(sessionId, update.toolCallId, 'failure');
    }
  }

  /** Records that the runner or the user rejected this tool call. */
  public denied(sessionId: string, toolCallId: string): void {
    this.deniedTools.add(`${sessionId}:${toolCallId}`);
    this.session.outcome(sessionId, toolCallId, 'denied');
  }

  public async close(): Promise<void> {
    this.deniedTools.clear();
    await this.session.close();
  }
}
