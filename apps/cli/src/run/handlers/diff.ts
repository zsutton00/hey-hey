/**
 * Handler: diff
 *
 * Tracks touched files on the run context.
 * If the diff is awaiting a permission event (Claude), buffers it
 * so the permission handler can merge it.
 */

import { extractFilePathsFromToolInput } from '../file-change-facts';
import type { DiffEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const handleDiff = async (event: DiffEvent, ctx: Run, deps: HandlerDeps): Promise<void> => {
  if (event.authority === 'confirmed' && event.files.length > 0) {
    deps.logger.debug('local.handler.diff.confirmed_file_change', {
      runId: ctx.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      fileCount: event.files.length,
      hasDiffBlob: event.diffBlob !== null && event.diffBlob.length > 0,
    });
    await ctx.recordFileChanges({
      runId: event.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      paths: event.files,
      occurredAt: event.timestamp,
      providerPatch: event.diffBlob,
    });
  } else if (event.authority === 'provisional') {
    deps.logger.debug('local.handler.diff.provisional_file_change', {
      runId: ctx.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      toolUseCount: event.toolUses.length,
      fileCount: event.files.length,
    });
    const staged = event.toolUses.flatMap((toolUse) => {
      const paths = extractFilePathsFromToolInput(toolUse.toolName, toolUse.input);
      if (paths.length === 0) {
        deps.logger.debug('local.handler.diff.provisional_tool_skipped_no_path', {
          runId: ctx.runId,
          toolUseId: toolUse.id,
          toolName: toolUse.toolName,
        });
      }
      return paths.length === 0
        ? []
        : [
            {
              toolUseId: toolUse.id,
              candidate: {
                runId: event.runId,
                provider: ctx.provider,
                providerSessionId: event.sessionId,
                providerThreadId: event.providerThreadId,
                providerTurnId: event.providerTurnId,
                paths,
                occurredAt: event.timestamp,
                providerPatch: event.diffBlob,
              },
            },
          ];
    });
    if (staged.length === 0) {
      deps.logger.debug('local.handler.diff.provisional_no_stageable_changes', {
        runId: ctx.runId,
        providerSessionId: event.sessionId,
        providerTurnId: event.providerTurnId,
      });
    }
    ctx.stageFileChanges(staged);
  } else if (event.patches.length > 0) {
    deps.logger.debug('local.handler.diff.evidence_enrichment', {
      runId: ctx.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerTurnId: event.providerTurnId,
      patchCount: event.patches.length,
      authority: event.authority,
    });
    await ctx.enrichFileChangeEvidence({
      providerSessionId: event.sessionId,
      providerTurnId: event.providerTurnId,
      patches: event.patches,
    });
  } else {
    deps.logger.debug('local.handler.diff.skipped_non_attributing', {
      runId: ctx.runId,
      provider: ctx.provider,
      providerSessionId: event.sessionId,
      providerThreadId: event.providerThreadId,
      providerTurnId: event.providerTurnId,
      fileCount: event.files.length,
      patchCount: event.patches.length,
      authority: event.authority,
      awaitingPermission: event.awaitingPermission,
    });
  }

  deps.logger.debug('local.handler.diff', {
    runId: ctx.runId,
    files: event.files,
    touchedFilesCount: ctx.getFileChangeProjection().length,
    awaitingPermission: event.awaitingPermission,
    authority: event.authority,
  });

  const key = event.itemId
    ? `item:${event.itemId}`
    : event.files
        .map((f) => f.toLowerCase())
        .sort()
        .join('|') || event.timestamp;

  if (event.awaitingPermission || event.itemId) {
    ctx.pendingDiffs.set(key, {
      event,
      files: event.files,
      ...(event.itemId ? { itemId: event.itemId } : {}),
    });
  }
};
