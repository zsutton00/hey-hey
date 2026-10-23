/**
 * Handler: permission
 *
 * Appends a permission request message to the conversation tail. Produces an
 * AgentRequestPermission UI element so the frontend can render the structured
 * permission request instead of raw JSON.
 */

import { z } from 'zod';
import {
  AgentRequestPermissionPayloadResponseTypeEnum,
  MessageType,
  MessageStatus,
  SystemMessageDataTypeEnum,
} from '../../shared/api/index';
import { PermissionRequestAgentType } from '../../shared/api/generated/api';
import type { SystemMessageData } from '../../shared/api/index';
import type { PermissionEvent, HandlerDeps, DiffEvent } from '../types';
import type { Run } from '../run';
import {
  tryParsePermissionRequestResponse,
  toPermissionRequestUiMarker,
  toPermissionRequestSummaryText,
} from '../../agents/message-mapping';

const permissionPayloadSchema = z.object({
  responseType: z.literal(AgentRequestPermissionPayloadResponseTypeEnum.AgentRequestPermissionV1),
  permissionRequest: z.object({
    id: z.string(),
    runId: z.string().nullable().optional(),
    permissionType: z.string(),
    sessionId: z.string(),
    agentId: z.string(),
    agentType: z.nativeEnum(PermissionRequestAgentType),
    timestamp: z.string(),
    idempotencyToken: z.string(),
    reason: z.string().nullable().optional(),
    agentIntent: z.string().nullable().optional(),
    referencedFiles: z.array(z.string()),
    referencedDiffs: z.array(z.string()),
  }),
  rawEvent: z.record(z.unknown()).nullable().optional(),
  enrichmentMetadata: z.record(z.unknown()).nullable().optional(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const matchPendingDiff = (
  ctx: Run,
  permissionFiles: string[],
  itemId: string | undefined,
): DiffEvent | null => {
  if (itemId) {
    const pendingByItem = ctx.pendingDiffs.get(`item:${itemId}`);
    if (pendingByItem) {
      ctx.pendingDiffs.delete(`item:${itemId}`);
      return pendingByItem.event;
    }

    for (const [key, pending] of ctx.pendingDiffs) {
      if (pending.itemId === itemId) {
        ctx.pendingDiffs.delete(key);
        return pending.event;
      }
    }
  }

  if (ctx.pendingDiffs.size === 0 || permissionFiles.length === 0) return null;

  const permSet = new Set(permissionFiles.map((f) => f.toLowerCase()));

  for (const [key, pending] of ctx.pendingDiffs) {
    const hasOverlap = pending.files.some((f) => permSet.has(f.toLowerCase()));
    if (hasOverlap) {
      ctx.pendingDiffs.delete(key);
      return pending.event;
    }
  }

  return null;
};

const mergeReferencedFiles = (
  parsed: NonNullable<ReturnType<typeof tryParsePermissionRequestResponse>>,
  matchedDiff: DiffEvent | null,
): NonNullable<ReturnType<typeof tryParsePermissionRequestResponse>> => {
  if (
    !matchedDiff ||
    parsed.permissionRequest.referencedFiles.length > 0 ||
    matchedDiff.files.length === 0
  ) {
    return parsed;
  }

  return {
    ...parsed,
    permissionRequest: {
      ...parsed.permissionRequest,
      referencedFiles: matchedDiff.files,
    },
  };
};

export const handlePermission = async (
  event: PermissionEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  if (ctx.taskMonitorId !== null) {
    deps.logger.info('local.handler.permission.task_monitor_projection_delegated', {
      runId: ctx.runId,
      taskMonitorId: ctx.taskMonitorId,
      providerActionId:
        isRecord(event.payload['permission_request']) &&
        typeof event.payload['permission_request']['id'] === 'string'
          ? event.payload['permission_request']['id']
          : null,
    });
    return;
  }

  const matchedDiff = matchPendingDiff(ctx, event.files, event.itemId);
  const payload = event.payload;

  // Build the JSON text that tryParsePermissionRequestResponse expects.
  // For events where the payload was merged from a parsed summary, the
  // permission fields are already at the top level of `payload`.
  // For permission_request_detected events they are also top-level.
  const payloadText = JSON.stringify(payload);
  const parsed = tryParsePermissionRequestResponse(payloadText);

  try {
    if (parsed) {
      const enrichedParsed = mergeReferencedFiles(parsed, matchedDiff);
      const uiElements = [toPermissionRequestUiMarker(enrichedParsed)];
      const summaryText = toPermissionRequestSummaryText(enrichedParsed);

      if (matchedDiff?.diffBlob) {
        const el = uiElements[0]!;
        if (el.payload) {
          const validated = permissionPayloadSchema.parse(el.payload);
          el.payload = { ...validated, diffBlob: matchedDiff.diffBlob } as NonNullable<
            typeof el.payload
          >;
        }
      }

      const data: SystemMessageData = {
        type: SystemMessageDataTypeEnum.Questions,
        title: 'Permission Request',
        response: summaryText,
        detectedIntent: 'permission_request',
        intentConfidence: 1,
        ragEnabled: false,
        uiElements,
        triggerNotification: true,
      };

      const messageId = await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: {
          type: MessageType.System,
          status: MessageStatus.Open,
          projectId: ctx.projectId,
          data,
        },
        stamp: null,
      });
      ctx.recordPermissionRequestMessage(parsed.permissionRequest.id, messageId, data);
      ctx.observeProviderPhase('awaiting_approval');
      return;
    }

    // Fallback: could not parse structured permission — post as plain text.
    const permReq = isRecord(payload['permission_request']) ? payload['permission_request'] : null;
    const permissionType =
      (permReq && typeof permReq['permission_type'] === 'string'
        ? permReq['permission_type']
        : null) ?? 'unknown';
    const permissionFiles = event.files.length > 0 ? event.files : (matchedDiff?.files ?? []);

    const parts = [
      `Permission requested: ${permissionType}`,
      ...(permissionFiles.length > 0 ? [`Files: ${permissionFiles.join(', ')}`] : []),
    ];

    const data: SystemMessageData = {
      type: SystemMessageDataTypeEnum.Agent,
      actionHint: 'permission_requested',
      response: parts.join('\n\n'),
      detectedIntent: 'permission_request',
      intentConfidence: 1,
      triggerNotification: true,
    };

    await deps.poster.createOutOfBand({
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      conversationId: ctx.conversationId,
      dto: {
        type: MessageType.System,
        status: MessageStatus.Open,
        projectId: ctx.projectId,
        data,
      },
      stamp: null,
    });
    ctx.observeProviderPhase('awaiting_approval');
  } catch (error) {
    const permReq = isRecord(payload['permission_request']) ? payload['permission_request'] : null;
    const requestId =
      (permReq && typeof permReq['id'] === 'string' ? permReq['id'] : null) ?? event.timestamp;
    deps.logger.error('local.handler.permission.prepend_failed', {
      runId: ctx.runId,
      requestId,
      error,
    });
  }
};
