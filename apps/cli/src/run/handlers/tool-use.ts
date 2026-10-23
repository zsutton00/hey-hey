/**
 * Handler: tool_use
 *
 * Persists tool usage entries unless --no-track-tools is set.
 */

import { extractFilePathsFromToolInput, isFileChangingTool } from '../file-change-facts';
import type { ToolResultEvent, ToolUseEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const handleToolUse = async (
  event: ToolUseEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  deps.logger.debug('local.handler.tool_use', {
    runId: ctx.runId,
    tools: event.blocks.map((b) => b.toolName),
    blockCount: event.blocks.length,
  });

  ctx.recordToolUsage(event.blocks);

  if (ctx.provider !== 'opencode') return;
  const resultsById = new Map(event.results.map((result) => [result.toolUseId, result]));
  for (const block of event.blocks) {
    const result = resultsById.get(block.id);
    if (!result) {
      deps.logger.debug('local.handler.tool_use.opencode_skipped_missing_result', {
        runId: ctx.runId,
        toolUseId: block.id,
        toolName: block.toolName,
        providerSessionId: event.sessionId,
        providerTurnId: event.providerTurnId,
      });
      continue;
    }
    if (result.isError) {
      deps.logger.warn('local.handler.tool_use.opencode_skipped_error_result', {
        runId: ctx.runId,
        toolUseId: block.id,
        toolName: block.toolName,
        providerSessionId: event.sessionId,
        providerTurnId: event.providerTurnId,
      });
      continue;
    }
    if (!isFileChangingTool(block.toolName)) {
      deps.logger.debug('local.handler.tool_use.opencode_skipped_non_file_tool', {
        runId: ctx.runId,
        toolUseId: block.id,
        toolName: block.toolName,
        providerSessionId: event.sessionId,
        providerTurnId: event.providerTurnId,
      });
      continue;
    }
    const paths = extractFilePathsFromToolInput(block.toolName, block.input);
    if (paths.length === 0) {
      deps.logger.warn('local.handler.tool_use.opencode_skipped_no_paths', {
        runId: ctx.runId,
        toolUseId: block.id,
        toolName: block.toolName,
        providerSessionId: event.sessionId,
        providerTurnId: event.providerTurnId,
      });
      continue;
    }
    deps.logger.debug('local.handler.tool_use.opencode_confirmed_file_change', {
      runId: ctx.runId,
      toolUseId: block.id,
      toolName: block.toolName,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      pathCount: paths.length,
    });
    await ctx.recordFileChanges({
      runId: event.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      paths,
      occurredAt: event.timestamp,
      providerPatch: null,
    });
  }
};

export const handleToolResult = async (
  event: ToolResultEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  for (const result of event.results) {
    deps.logger.debug('local.handler.tool_result.file_change_correlation', {
      runId: ctx.runId,
      toolUseId: result.toolUseId,
      isError: result.isError,
    });
    await ctx.confirmStagedFileChange({
      toolUseId: result.toolUseId,
      isError: result.isError,
      providerSessionId: event.sessionId,
      occurredAt: event.timestamp,
    });
  }
};
