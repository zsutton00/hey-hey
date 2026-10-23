/**
 * Normalize — the single normalization boundary.
 *
 * raw LocalAgentOutputEvent → typed NormalizedEvent
 *
 * Two paths:
 *   1. Provider events — already carry canonical_event from the upstream
 *      normalizer (provider-event-normalization.ts). Read structured fields
 *      from canonical_event.diff / canonical_event.permission_request.
 *   2. Local/simple events — flat payloads emitted by the session runner
 *      or service layer. Extract fields directly from the payload.
 *
 * Nothing downstream should parse raw event payloads. This is the only
 * place that knows how payloads are shaped.
 */

import { z } from 'zod';
import {
  AgentQuestionPayloadAgentTypeEnum,
  AgentQuestionPayloadResponseTypeEnum,
} from '../shared/api/generated/api';
import type { AgentQuestionPayload } from '../shared/api/generated/api';
import type {
  AgentQuestionEvent,
  QuestionAnsweredEvent,
  LocalAgentOutputEvent,
  NormalizedEvent,
  RunStartedEvent,
  RunCompletedEvent,
  AssistantDeltaEvent,
  AssistantCompleteEvent,
  ProcessingStatusEvent,
  ConversationPhaseEvent,
  DiffEvent,
  PermissionEvent,
  PermissionDecisionRecordedEvent,
  ToolUseEvent,
  ToolUseNormalizedBlock,
  ToolResultEvent,
  ToolResultNormalizedBlock,
} from './types';
import { isConversationPhase, isProviderPhase } from './types';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNormalizedFacts = (payload: Record<string, unknown>): Record<string, unknown> | null =>
  isRecord(payload['normalized_facts'])
    ? payload['normalized_facts']
    : isRecord(payload['normalizedFacts'])
      ? payload['normalizedFacts']
      : null;

const readFactsRouting = (payload: Record<string, unknown>): Record<string, unknown> | null => {
  const facts = readNormalizedFacts(payload);
  return facts && isRecord(facts['routing']) ? facts['routing'] : null;
};

const readRoutingItemId = (payload: Record<string, unknown>): string | null => {
  const factsRouting = readFactsRouting(payload);
  if (factsRouting) {
    const factItemId = readString(factsRouting['itemId']) ?? readString(factsRouting['item_id']);
    if (factItemId) return factItemId;
  }
  const routing = isRecord(payload['routing']) ? payload['routing'] : null;
  if (routing) {
    const direct = readString(routing['item_id']) ?? readString(routing['itemId']);
    if (direct) return direct;
  }

  const canonical = isRecord(payload['canonical_event']) ? payload['canonical_event'] : null;
  const canonicalRouting =
    canonical && isRecord(canonical['routing']) ? canonical['routing'] : null;
  if (canonicalRouting) {
    return readString(canonicalRouting['item_id']) ?? readString(canonicalRouting['itemId']);
  }

  return null;
};

const readRoutingString = (
  payload: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): string | null => {
  const factsRouting = readFactsRouting(payload);
  if (factsRouting) {
    const factValue =
      readString(factsRouting[camelKey]) ?? readString(factsRouting[snakeKey]);
    if (factValue) return factValue;
  }
  const routing = isRecord(payload['routing']) ? payload['routing'] : null;
  const canonical = isRecord(payload['canonical_event']) ? payload['canonical_event'] : null;
  const canonicalRouting =
    canonical && isRecord(canonical['routing']) ? canonical['routing'] : null;
  return (
    (routing ? (readString(routing[snakeKey]) ?? readString(routing[camelKey])) : null) ??
    (canonicalRouting
      ? (readString(canonicalRouting[snakeKey]) ?? readString(canonicalRouting[camelKey]))
      : null)
  );
};

const extractToolUseBlocks = (payload: Record<string, unknown>): ToolUseNormalizedBlock[] => {
  const facts = readNormalizedFacts(payload);
  const factBlocks = facts?.['toolUses'];
  if (Array.isArray(factBlocks)) {
    const blocks: ToolUseNormalizedBlock[] = [];
    for (const block of factBlocks) {
      if (!isRecord(block)) continue;
      const id = readString(block['toolUseId']) ?? readString(block['tool_use_id']);
      const toolName = readString(block['toolName']) ?? readString(block['tool_name']);
      if (!id || !toolName) continue;
      blocks.push({ id, toolName, input: isRecord(block['input']) ? block['input'] : {} });
    }
    if (blocks.length > 0) return blocks;
  }
  const canonical = isRecord(payload['canonical_event']) ? payload['canonical_event'] : null;
  const diff = canonical && isRecord(canonical['diff']) ? canonical['diff'] : null;
  const source = Array.isArray(payload['all_tool_use_blocks'])
    ? payload['all_tool_use_blocks']
    : diff && Array.isArray(diff['tool_use_blocks'])
      ? diff['tool_use_blocks']
      : [];
  const blocks: ToolUseNormalizedBlock[] = [];
  for (const block of source) {
    if (!isRecord(block)) continue;
    const id = readString(block['id']);
    const toolName = readString(block['tool_name']) ?? readString(block['toolName']);
    if (!id || !toolName) continue;
    blocks.push({
      id,
      toolName,
      input: isRecord(block['input']) ? block['input'] : {},
    });
  }
  return blocks;
};

const extractToolResultBlocks = (payload: Record<string, unknown>): ToolResultNormalizedBlock[] => {
  const facts = readNormalizedFacts(payload);
  const factResults = facts?.['toolResults'];
  if (Array.isArray(factResults)) {
    const results: ToolResultNormalizedBlock[] = [];
    for (const block of factResults) {
      if (!isRecord(block)) continue;
      const toolUseId = readString(block['toolUseId']) ?? readString(block['tool_use_id']);
      if (!toolUseId) continue;
      results.push({
        toolUseId,
        isError: block['isError'] === true || block['is_error'] === true,
        contentText: readString(block['content']),
      });
    }
    if (results.length > 0) return results;
  }
  const source = payload['all_tool_result_blocks'];
  if (!Array.isArray(source)) return [];
  const results: ToolResultNormalizedBlock[] = [];
  for (const block of source) {
    if (!isRecord(block)) continue;
    const toolUseId = readString(block['tool_use_id']) ?? readString(block['toolUseId']);
    if (!toolUseId) continue;
    results.push({
      toolUseId,
      isError: block['is_error'] === true,
      contentText: readString(block['content_text']),
    });
  }
  return results;
};

// ---------------------------------------------------------------------------
// Provider-event file extraction
// ---------------------------------------------------------------------------

/**
 * Extract file paths from a canonical diff object
 * (payload.canonical_event.diff).
 */
const extractFilesFromCanonicalDiff = (diff: Record<string, unknown>): string[] => {
  const files: string[] = [];

  // diff.files — array of strings (produced by provider-event-normalization)
  const filesList = diff['files'];
  if (Array.isArray(filesList)) {
    for (const entry of filesList) {
      if (typeof entry === 'string') {
        const trimmed = readString(entry);
        if (trimmed) files.push(trimmed);
      } else if (isRecord(entry) && typeof entry['path'] === 'string') {
        const trimmed = readString(entry['path']);
        if (trimmed) files.push(trimmed);
      }
    }
  }

  // diff.tool_use_blocks[].input.file_path — for Write/Edit tool_use diffs
  const blocks = diff['tool_use_blocks'];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (isRecord(block) && isRecord(block['input'])) {
        const filePath = readString(block['input']['file_path']);
        if (filePath && !files.includes(filePath)) {
          files.push(filePath);
        }
      }
    }
  }

  return files;
};

/**
 * Extract file paths from a canonical permission_request object and
 * provider_metadata for permission events.
 */
const extractFilesFromCanonicalPermission = (payload: Record<string, unknown>): string[] => {
  const files: string[] = [];
  const facts = readNormalizedFacts(payload);
  const permissionRequest = facts && isRecord(facts['permissionRequest'])
    ? facts['permissionRequest']
    : null;
  if (permissionRequest && Array.isArray(permissionRequest['referencedFiles'])) {
    for (const ref of permissionRequest['referencedFiles']) {
      if (typeof ref === 'string') files.push(ref);
    }
  }

  // enrichment_metadata.referenced_files (top-level on payload)
  const enrichment = payload['enrichment_metadata'] ?? payload['enrichment'];
  if (isRecord(enrichment)) {
    const refs = enrichment['referenced_files'];
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        if (typeof ref === 'string') files.push(ref);
      }
    }
  }

  // canonical_event.permission_request.raw_event.toolInput.file_path
  const canonical = payload['canonical_event'];
  if (isRecord(canonical)) {
    const permReq = canonical['permission_request'];
    if (isRecord(permReq)) {
      const rawEvent = permReq['raw_event'];
      if (isRecord(rawEvent)) {
        const toolInput = rawEvent['toolInput'];
        if (isRecord(toolInput) && typeof toolInput['file_path'] === 'string') {
          files.push(toolInput['file_path']);
        }
      }
    }
  }

  return files;
};

/**
 * Extract file paths from flat (non-canonical) permission payloads.
 * Used for locally-emitted permission events and summary-parsed permissions.
 */
const extractFilesFromFlatPermission = (payload: Record<string, unknown>): string[] => {
  const files: string[] = [];

  const enrichment = payload['enrichment_metadata'] ?? payload['enrichment'];
  if (isRecord(enrichment)) {
    const refs = enrichment['referenced_files'];
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        if (typeof ref === 'string') files.push(ref);
      }
    }
  }

  const permReq = payload['permission_request'];
  if (isRecord(permReq)) {
    const rawEvent = permReq['raw_event'];
    if (isRecord(rawEvent)) {
      const toolInput = rawEvent['toolInput'];
      if (isRecord(toolInput) && typeof toolInput['file_path'] === 'string') {
        files.push(toolInput['file_path']);
      }
    }
  }

  return files;
};

/**
 * Extract file paths from flat diff payloads (local/legacy events).
 */
const extractFilesFromFlatDiff = (payload: Record<string, unknown>): string[] => {
  const files: string[] = [];

  const diffs = payload['diffs'];
  if (Array.isArray(diffs)) {
    for (const diff of diffs) {
      if (isRecord(diff) && typeof diff['filePath'] === 'string') {
        files.push(diff['filePath']);
      }
    }
  }

  const filesList = payload['files'];
  if (Array.isArray(filesList)) {
    for (const file of filesList) {
      if (typeof file === 'string') {
        files.push(file);
      } else if (isRecord(file) && typeof file['path'] === 'string') {
        files.push(file['path']);
      }
    }
  }

  return files;
};

/**
 * Try to parse a permission request from the summary JSON string.
 * Returns the parsed payload if the summary is a permission request, null otherwise.
 */
const tryParsePermissionFromSummary = (
  payload: Record<string, unknown>,
): Record<string, unknown> | null => {
  const summary = readString(payload['summary']);
  if (!summary) return null;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (isRecord(parsed) && parsed['responseType'] === 'agent_request_permission_v1') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const agentQuestionPayloadSchema = z.object({
  responseType: z.literal(AgentQuestionPayloadResponseTypeEnum.AgentQuestionV1),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  agentType: z.nativeEnum(AgentQuestionPayloadAgentTypeEnum),
  idempotencyToken: z.string().min(1),
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string(),
      multiSelect: z.boolean(),
      options: z.array(z.object({ label: z.string(), description: z.string() })),
    }),
  ),
  answers: z.record(z.string(), z.string()).nullable().optional(),
  answeredAt: z.string().nullable().optional(),
});

/**
 * Try to parse an agent question from the summary JSON string.
 * Returns the validated payload if the summary is an `agent_question_v1`, null otherwise.
 */
const tryParseAgentQuestionFromSummary = (
  payload: Record<string, unknown>,
): AgentQuestionPayload | null => {
  const summary = readString(payload['summary']);
  if (!summary) return null;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (!isRecord(parsed) || parsed['responseType'] !== 'agent_question_v1') return null;
    const validated = agentQuestionPayloadSchema.safeParse(parsed);
    return validated.success ? (validated.data as AgentQuestionPayload) : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// normalizeEvent — the single entry point
// ---------------------------------------------------------------------------

export const normalizeEvent = (
  event: LocalAgentOutputEvent,
  provider: 'claude' | 'codex' | 'opencode',
): NormalizedEvent => {
  const payload = event.payload;

  // -- Lifecycle (always local events with flat payloads) --

  if (event.eventType === 'run_started') {
    return {
      ...event,
      kind: 'run_started',
      prompt: readString(payload['prompt']),
    } satisfies RunStartedEvent;
  }

  if (event.eventType === 'run_completed') {
    return {
      ...event,
      kind: 'run_completed',
      status: payload['status'] === 'error' ? 'error' : 'complete',
    } satisfies RunCompletedEvent;
  }

  // -- Processing status (local event, flat payload) --

  if (event.eventType === 'processing_status') {
    const rawPhase = payload['phase'];
    const phase = isProviderPhase(rawPhase) ? rawPhase : undefined;
    return {
      ...event,
      kind: 'processing_status',
      loadingText: readString(payload['loadingText']),
      toolName: readString(payload['toolName']),
      toolPhase: readString(payload['toolPhase']),
      ...(phase !== undefined ? { phase } : {}),
    } satisfies ProcessingStatusEvent;
  }

  if (event.eventType === 'conversation_phase') {
    const phase = payload['phase'];
    if (isConversationPhase(phase)) {
      return {
        ...event,
        kind: 'conversation_phase',
        phase,
      } satisfies ConversationPhaseEvent;
    }
  }

  // -- Diff (provider event — canonical payload from upstream normalizer) --

  if (event.eventType === 'file_diff_message' || event.eventType === 'file_diff_detected') {
    const canonical = isRecord(payload['canonical_event']) ? payload['canonical_event'] : null;
    const canonicalDiff = canonical && isRecord(canonical['diff']) ? canonical['diff'] : null;
    const facts = readNormalizedFacts(payload);
    const factDiff = facts && isRecord(facts['diff']) ? facts['diff'] : null;
    const diff = canonicalDiff ?? factDiff;
    const itemId = readRoutingItemId(payload);
    const providerThreadId = readRoutingString(payload, 'thread_id', 'threadId');
    const providerTurnId = readRoutingString(payload, 'turn_id', 'turnId');

    const extractedFiles = diff
      ? extractFilesFromCanonicalDiff(diff)
      : extractFilesFromFlatDiff(payload);
    const deliveryMode = canonicalDiff ? readString(canonicalDiff['delivery_mode']) : null;

    // Codex turn/diff/updated is a provider snapshot of repository diff state,
    // not item-level proof that this run touched every listed path.
    const files = provider === 'codex' && deliveryMode === 'batch' ? [] : extractedFiles;

    const diffBlob = diff
      ? readString(diff['diff_blob'])
      : (readString(payload['diff_blob']) ?? readString(payload['diffContent']));
    const providerEventType = readString(payload['eventType']);
    const declaredAuthority = diff
      ? readString(diff['attribution_authority']) ?? readString(diff['authority'])
      : null;
    const toolUses = extractToolUseBlocks(payload);
    const authority =
      declaredAuthority === 'confirmed' ||
      declaredAuthority === 'provisional' ||
      declaredAuthority === 'diagnostic'
        ? declaredAuthority
        : provider === 'codex' && providerEventType === 'item/completed'
          ? 'confirmed'
          : provider === 'claude' && toolUses.length > 0
            ? 'provisional'
            : 'diagnostic';
    const patches: Array<{ path: string; diff: string }> = [];
    const rawPatches = diff?.['patches'];
    if (Array.isArray(rawPatches)) {
      for (const patch of rawPatches) {
        if (!isRecord(patch)) continue;
        const patchPath = readString(patch['path']);
        const patchDiff = readString(patch['diff']) ?? readString(patch['patch']);
        if (patchPath && patchDiff) patches.push({ path: patchPath, diff: patchDiff });
      }
    }

    return {
      ...event,
      kind: 'diff',
      files,
      awaitingPermission: provider === 'claude',
      ...(itemId ? { itemId } : {}),
      diffBlob,
      authority,
      providerThreadId,
      providerTurnId,
      toolUses,
      patches,
    } satisfies DiffEvent;
  }

  // -- Permission (provider event — canonical payload) --

  if (event.eventType === 'permission_request_detected') {
    const hasCanonical = isRecord(payload['canonical_event']);
    const files = hasCanonical
      ? extractFilesFromCanonicalPermission(payload)
      : extractFilesFromFlatPermission(payload);
    const itemId = readRoutingItemId(payload);

    return {
      ...event,
      kind: 'permission',
      files,
      ...(itemId ? { itemId } : {}),
    } satisfies PermissionEvent;
  }

  // -- Agent output (assistant, user, or permission-in-summary) --

  if (event.eventType === 'agent_output') {
    const messageType = readString(payload['messageType']);
    const summary = readString(payload['summary']);
    const taskComplete = payload['taskComplete'] === true;

    // Permission requests can arrive embedded in the summary JSON.
    // Merge the parsed fields into the payload so the permission handler
    // can read permission_request, enrichment_metadata, etc.
    const permissionPayload = tryParsePermissionFromSummary(payload);
    if (permissionPayload) {
      return {
        ...event,
        payload: { ...payload, ...permissionPayload },
        kind: 'permission',
        files: extractFilesFromFlatPermission(permissionPayload),
      } satisfies PermissionEvent;
    }

    const agentQuestion = tryParseAgentQuestionFromSummary(payload);
    if (agentQuestion) {
      return {
        ...event,
        kind: 'agent_question',
        requestId: agentQuestion.requestId,
        question: agentQuestion,
      } satisfies AgentQuestionEvent;
    }

    if (messageType === 'assistant') {
      const text = summary ?? '';
      // Only the provider's final message (the one the runner tagged with
      // taskComplete) completes the processing anchor. Any other assistant
      // block — including one carrying a structured responseType JSON —
      // flows as a delta and is prepended as its own message. The delta
      // handler runs `dispatchResponseType` itself so structured JSON still
      // renders with its UI elements.
      if (taskComplete) {
        return {
          ...event,
          kind: 'assistant_complete',
          summary: text,
        } satisfies AssistantCompleteEvent;
      }
      return {
        ...event,
        kind: 'assistant_delta',
        summary: text,
      } satisfies AssistantDeltaEvent;
    }
  }

  // -- Permission decision recorded (local event emitted after the runner resolves a decision) --

  if (event.eventType === 'permission_decision_ui') {
    const requestId = readString(payload['requestId']);
    const decision = payload['decision'];
    const decidedAt = readString(payload['decidedAt']);
    const userId = readString(payload['userId']);
    if (
      requestId &&
      decidedAt &&
      (decision === 'approve' ||
        decision === 'always_approve' ||
        decision === 'whitelist' ||
        decision === 'deny')
    ) {
      return {
        ...event,
        kind: 'permission_decision_recorded',
        requestId,
        decision,
        decidedAt,
        ...(userId ? { userId } : {}),
      } satisfies PermissionDecisionRecordedEvent;
    }
  }

  // -- Question answered (local event emitted after the runner resolves a waiting question) --

  if (event.eventType === 'question_answer_ui') {
    const requestId = readString(payload['requestId']);
    const answeredAt = readString(payload['answeredAt']);
    const answers = z.record(z.string(), z.string()).safeParse(payload['answers']);
    if (requestId && answeredAt && answers.success) {
      return {
        ...event,
        kind: 'question_answered',
        requestId,
        answers: answers.data,
        answeredAt,
      } satisfies QuestionAnsweredEvent;
    }
  }

  // -- Tool use (provider events carrying all_tool_use_blocks from upstream normalizer) --
  // Only fire for assistant/agent_message events — these are the only event types that
  // carry tool_use blocks as part of a model turn. Diff and permission events can also
  // carry all_tool_use_blocks (they're extracted unconditionally upstream) but those are
  // handled by their own branches above and must not be double-dispatched here.

  const toolResults = extractToolResultBlocks(payload);
  const allToolBlocks = Array.isArray(payload['all_tool_use_blocks'])
    ? payload['all_tool_use_blocks']
    : readNormalizedFacts(payload)?.['toolUses'];
  if (
    (event.eventType === 'assistant' ||
      event.eventType === 'agent_message' ||
      event.eventType === 'tool_use') &&
    Array.isArray(allToolBlocks) &&
    allToolBlocks.length > 0
  ) {
    const blocks: ToolUseNormalizedBlock[] = [];
    for (const block of allToolBlocks) {
      if (isRecord(block)) {
        const id = readString(block['id']) ?? readString(block['toolUseId']);
        const toolName = readString(block['tool_name']) ?? readString(block['toolName']);
        if (!id || !toolName) continue;
        blocks.push({
          id,
          toolName,
          input: isRecord(block['input']) ? block['input'] : {},
        });
      }
    }
    if (blocks.length > 0) {
      return {
        ...event,
        kind: 'tool_use',
        blocks,
        results: toolResults,
        providerThreadId: readRoutingString(payload, 'thread_id', 'threadId'),
        providerTurnId: readRoutingString(payload, 'turn_id', 'turnId'),
      } satisfies ToolUseEvent;
    }
  }

  if (toolResults.length > 0) {
    return {
      ...event,
      kind: 'tool_result',
      results: toolResults,
      providerThreadId: readRoutingString(payload, 'thread_id', 'threadId'),
      providerTurnId: readRoutingString(payload, 'turn_id', 'turnId'),
    } satisfies ToolResultEvent;
  }

  // -- Everything else --
  return { ...event, kind: 'other' };
};
