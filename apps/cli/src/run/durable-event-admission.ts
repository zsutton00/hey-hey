import {
  toBoundedDurableString,
  toDurableJsonValue,
  type DurableCommandLifecycle,
  type DurableDiffFacts,
  type DurableDiffFile,
  type DurablePermissionRequest,
  type DurableProvider,
  type DurableRunEventInput,
  type DurableRoutingFacts,
  type DurableToolResult,
  type DurableToolUseBlock,
} from '../run-store/durable-events';

export interface DurableAdmissionContext {
  readonly runId: string;
  readonly provider: DurableProvider;
  readonly providerSessionId: string | null;
  readonly providerConversationId: string | null;
  readonly providerSessionAgentId: string | null;
  readonly repositoryPath: string | null;
}

/** Boundary shape accepted from legacy/local event producers and migrations. */
export interface DurableAdmissionEventInput {
  readonly run_id: string;
  readonly actor: 'app' | 'agent' | 'system';
  readonly event_type: 'run_started' | 'prompt_sent' | 'agent_output' | 'run_completed' | 'post_processed';
  readonly state_version: number;
  readonly payload?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() || null : null;

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const readNestedRecord = (
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null => {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return null;
};

const readFirstString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
};

const readRouting = (payload: Record<string, unknown>): DurableRoutingFacts => {
  const facts = readNestedRecord(payload, ['normalized_facts', 'normalizedFacts']);
  const source = facts ? readNestedRecord(facts, ['routing']) : null;
  const routing = source ?? readNestedRecord(payload, ['routing']) ?? {};
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const canonicalRouting = canonical ? readNestedRecord(canonical, ['routing']) : null;
  const read = (keys: readonly string[]): string | null =>
    readFirstString(routing, keys) ??
    (canonicalRouting ? readFirstString(canonicalRouting, keys) : null);
  return {
    providerThreadId: read(['providerThreadId', 'provider_thread_id', 'threadId', 'thread_id']),
    providerTurnId: read(['providerTurnId', 'provider_turn_id', 'turnId', 'turn_id']),
    itemId: read(['itemId', 'item_id']),
  };
};

const readProvider = (
  payload: Record<string, unknown>,
  context: DurableAdmissionContext,
): DurableProvider => {
  const facts = readNestedRecord(payload, ['normalized_facts', 'normalizedFacts']);
  return readString(facts?.['provider']) ?? readString(payload['provider']) ?? context.provider;
};

const readProviderSessionId = (
  payload: Record<string, unknown>,
  context: DurableAdmissionContext,
): string | null => {
  const facts = readNestedRecord(payload, ['normalized_facts', 'normalizedFacts']);
  return (
    readNullableString(facts?.['sessionId']) ??
    readNullableString(facts?.['providerSessionId']) ??
    readNullableString(payload['session_id']) ??
    readNullableString(payload['provider_session_id']) ??
    context.providerSessionId
  );
};

const readNormalizedFacts = (payload: Record<string, unknown>): Record<string, unknown> | null =>
  readNestedRecord(payload, ['normalized_facts', 'normalizedFacts']);

const toInputRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const readToolUses = (
  payload: Record<string, unknown>,
  observedAt: string,
): DurableToolUseBlock[] => {
  const facts = readNormalizedFacts(payload);
  const factBlocks = facts ? facts['toolUses'] : undefined;
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const diff = canonical ? readNestedRecord(canonical, ['diff']) : null;
  const source =
    Array.isArray(factBlocks) && factBlocks.length > 0
      ? factBlocks
      : Array.isArray(payload['all_tool_use_blocks'])
        ? payload['all_tool_use_blocks']
        : diff?.['tool_use_blocks'];
  const blocks: DurableToolUseBlock[] = [];
  for (const candidate of readArray(source)) {
    if (!isRecord(candidate)) continue;
    const toolUseId = readString(
      candidate['toolUseId'] ?? candidate['tool_use_id'] ?? candidate['id'],
    );
    const toolName = readString(candidate['toolName'] ?? candidate['tool_name'] ?? candidate['name']);
    if (!toolUseId || !toolName) continue;
    blocks.push({
      toolUseId,
      toolName,
      input: toDurableJsonValue(candidate['input']) ?? {},
      observedAt: readString(candidate['observedAt']) ?? observedAt,
    });
  }
  return blocks;
};

const readToolResults = (
  payload: Record<string, unknown>,
  observedAt: string,
): DurableToolResult[] => {
  const facts = readNormalizedFacts(payload);
  const factResults = facts ? facts['toolResults'] : undefined;
  const source =
    Array.isArray(factResults) && factResults.length > 0
      ? factResults
      : payload['all_tool_result_blocks'];
  const results: DurableToolResult[] = [];
  for (const candidate of readArray(source)) {
    if (!isRecord(candidate)) continue;
    const toolUseId = readString(candidate['toolUseId'] ?? candidate['tool_use_id']);
    if (!toolUseId) continue;
    const content =
      toBoundedDurableString(candidate['content']) ??
      toBoundedDurableString(candidate['contentText']) ??
      toBoundedDurableString(candidate['content_text']);
    results.push({
      toolUseId,
      isError: candidate['isError'] === true || candidate['is_error'] === true,
      content,
      observedAt: readString(candidate['observedAt']) ?? observedAt,
    });
  }
  return results;
};

const readPermissionRequest = (
  payload: Record<string, unknown>,
  context: DurableAdmissionContext,
  requestedAt: string,
): DurablePermissionRequest | null => {
  const facts = readNormalizedFacts(payload);
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const source =
    (facts ? readNestedRecord(facts, ['permissionRequest', 'permission_request']) : null) ??
    (canonical ? readNestedRecord(canonical, ['permission_request', 'permissionRequest']) : null) ??
    readNestedRecord(payload, ['permission_request', 'permissionRequest']);
  if (!source) return null;

  const requestId = readString(source['requestId'] ?? source['request_id'] ?? source['id']);
  const permissionType = readString(
    source['permissionType'] ?? source['permission_type'] ?? source['type'],
  );
  if (!requestId || !permissionType) return null;

  const enrichment = readNestedRecord(payload, ['enrichment_metadata', 'enrichment']);
  const factReferencedFiles = facts
    ? readNestedRecord(facts, ['permissionRequest', 'permission_request'])
    : null;
  const referencedFiles = [
    ...readArray(facts?.['referencedFiles'])
      .map(readString)
      .filter((value): value is string => value !== null),
    ...readArray(factReferencedFiles?.['referencedFiles'])
      .map(readString)
      .filter((value): value is string => value !== null),
    ...readArray(enrichment?.['referenced_files'])
      .map(readString)
      .filter((value): value is string => value !== null),
  ];
  const uniqueFiles = [...new Set(referencedFiles)];
  const toolInput = readNestedRecord(payload, ['tool_input', 'toolInput']);
  const filePath = toolInput ? readFirstString(toolInput, ['file_path', 'filePath']) : null;
  if (filePath && !uniqueFiles.includes(filePath)) uniqueFiles.push(filePath);

  const exactAction = readNestedRecord(source, ['exactAction', 'exact_action']) ?? source;
  const action = readString(exactAction['action']) ?? readString(payload['tool_name']);
  const target =
    readString(exactAction['target']) ??
    (filePath ? filePath : readString(toolInput?.['command'])) ??
    permissionType;
  const fingerprint = readString(exactAction['fingerprint']);
  if (!action || !target || !fingerprint) return null;

  return {
    requestId,
    permissionType,
    exactAction: {
      action,
      target,
      fingerprint,
      createdAt:
        readNullableString(exactAction['createdAt']) ??
        readNullableString(exactAction['created_at']),
      expiresAt:
        readNullableString(exactAction['expiresAt']) ??
        readNullableString(exactAction['expires_at']),
    },
    referencedFiles: uniqueFiles,
    reason:
      readNullableString(factReferencedFiles?.['reason']) ??
      readNullableString(facts?.['reason']) ??
      readNullableString(enrichment?.['reason']),
    agentIntent:
      readNullableString(factReferencedFiles?.['agentIntent']) ??
      readNullableString(facts?.['agentIntent']) ??
      readNullableString(enrichment?.['agent_intent']),
    requestedAt:
      readString(factReferencedFiles?.['requestedAt']) ??
      readString(facts?.['requestedAt']) ??
      readString(source['requestedAt']) ??
      readString(source['timestamp']) ??
      requestedAt,
  };
};

const readDiffFacts = (
  payload: Record<string, unknown>,
  context: DurableAdmissionContext,
  observedAt: string,
): DurableDiffFacts | null => {
  const facts = readNormalizedFacts(payload);
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const source =
    (facts ? readNestedRecord(facts, ['diff']) : null) ??
    (canonical ? readNestedRecord(canonical, ['diff']) : null) ??
    payload;
  if (!source) return null;

  const files: DurableDiffFile[] = [];
  for (const candidate of readArray(source['files'])) {
    if (typeof candidate === 'string') {
      const filePath = readString(candidate);
      if (filePath) files.push({ path: filePath, status: 'modified', additions: null, deletions: null });
      continue;
    }
    if (!isRecord(candidate)) continue;
    const filePath = readString(candidate['path'] ?? candidate['file'] ?? candidate['filename']);
    if (!filePath) continue;
    const statusValue = readString(candidate['status']);
    const status =
      statusValue === 'added' ||
      statusValue === 'modified' ||
      statusValue === 'deleted' ||
      statusValue === 'renamed'
        ? statusValue
        : 'modified';
    files.push({
      path: filePath,
      status,
      additions: readNumber(candidate['additions']),
      deletions: readNumber(candidate['deletions']),
    });
  }

  for (const candidate of readArray(source['diffs'])) {
    if (!isRecord(candidate)) continue;
    const filePath = readString(
      candidate['path'] ?? candidate['filePath'] ?? candidate['file_path'],
    );
    if (!filePath || files.some((file) => file.path === filePath)) continue;
    const statusValue = readString(candidate['status']);
    const status =
      statusValue === 'added' ||
      statusValue === 'modified' ||
      statusValue === 'deleted' ||
      statusValue === 'renamed'
        ? statusValue
        : 'modified';
    files.push({
      path: filePath,
      status,
      additions: readNumber(candidate['additions']),
      deletions: readNumber(candidate['deletions']),
    });
  }

  const patches: Array<{ path: string; patch: string }> = [];
  for (const candidate of readArray(source['patches'])) {
    if (!isRecord(candidate)) continue;
    const path = readString(candidate['path']);
    const patch = readString(candidate['patch'] ?? candidate['diff']);
    if (path && patch) patches.push({ path, patch });
  }
  const diffBlob = readString(source['diff_blob'] ?? source['diffBlob']);
  const artifactRef =
    readString(source['canonicalArtifactRef'] ?? source['canonical_artifact_ref']) ??
    readString(source['blob_ref'] ?? source['diff_blob_ref'] ?? source['diffBlobRef']);
  if (files.length === 0 && patches.length === 0 && !artifactRef && !diffBlob) return null;

  const provider = readProvider(payload, context);
  const eventType = readString(payload['eventType']) ?? '';
  const declaredAuthority = readString(
    source['authority'] ?? source['attribution_authority'],
  );
  const authority =
    declaredAuthority === 'confirmed' ||
    declaredAuthority === 'provisional' ||
    declaredAuthority === 'diagnostic'
      ? declaredAuthority
      : provider === 'codex' && eventType === 'item/completed'
        ? 'confirmed'
        : files.length > 0
          ? 'provisional'
          : 'diagnostic';

  return {
    provider,
    providerSessionId: readProviderSessionId(payload, context),
    providerThreadId: readRouting(payload).providerThreadId,
    providerTurnId: readRouting(payload).providerTurnId,
    itemId: readRouting(payload).itemId,
    authority,
    files,
    patches,
    canonicalArtifactRef: artifactRef,
    observedAt,
  };
};

const readCommandLifecycle = (
  payload: Record<string, unknown>,
  routing: DurableRoutingFacts,
): DurableCommandLifecycle | null => {
  const facts = readNormalizedFacts(payload);
  const factLifecycle = facts ? readNestedRecord(facts, ['commandLifecycle', 'command_lifecycle']) : null;
  if (factLifecycle) {
    const commandId = readString(factLifecycle['commandId'] ?? factLifecycle['command_id']);
    const status = readString(factLifecycle['status']);
    if (
      commandId &&
      (status === 'started' || status === 'completed' || status === 'failed')
    ) {
      return { commandId, status, exitCode: readNumber(factLifecycle['exitCode'] ?? factLifecycle['exit_code']) };
    }
  }
  // A normalized provider event deliberately records `null` when its item is
  // not a shell command. Do not reconstruct a lifecycle from the generic
  // routing/event-type fallback in that case.
  if (facts && ('commandLifecycle' in facts || 'command_lifecycle' in facts)) return null;
  const commandId = routing.itemId;
  const eventType = readString(payload['eventType']) ?? '';
  if (!commandId) return null;
  const canonical = readNestedRecord(payload, ['canonical_event', 'canonicalEvent']);
  const status = canonical ? readNestedRecord(canonical, ['status']) : null;
  const statusState = status ? readString(status['state']) : null;
  if (eventType === 'item/started' || statusState === 'in_progress') {
    return { commandId, status: 'started', exitCode: null };
  }
  if (eventType === 'item/completed' || statusState === 'completed' || statusState === 'failed') {
    return {
      commandId,
      status: statusState === 'failed' ? 'failed' : 'completed',
      exitCode: readNumber(payload['exitCode'] ?? payload['exit_code']),
    };
  }
  return null;
};

const providerIdentityEvent = (
  input: DurableAdmissionEventInput,
  context: DurableAdmissionContext,
  payload: Record<string, unknown>,
  observedAt: string,
): DurableRunEventInput | null => {
  const providerSessionId = readProviderSessionId(payload, context);
  if (!providerSessionId || providerSessionId.startsWith('pending_')) return null;
  const providerEventType = readString(payload['eventType']);
  if (
    providerEventType !== 'thread/started' &&
    providerEventType !== 'session_started' &&
    providerEventType !== 'system/init'
  ) {
    return null;
  }
  const routing = readRouting(payload);
  return {
    run_id: input.run_id,
    actor: input.actor,
    event_type: 'agent_output',
    state_version: input.state_version,
    payload: {
      kind: 'provider_identity_observed',
      provider: readProvider(payload, context),
      providerSessionId,
      providerConversationId:
        readNullableString(payload['provider_conversation_id']) ?? context.providerConversationId,
      providerSessionAgentId: context.providerSessionAgentId,
      providerThreadId: routing.providerThreadId,
      providerTurnId: routing.providerTurnId,
      observedAt,
    },
  };
};

const projectProviderEvent = (
  input: DurableAdmissionEventInput,
  context: DurableAdmissionContext,
  payload: Record<string, unknown>,
  observedAt: string,
): DurableRunEventInput[] => {
  const projected: DurableRunEventInput[] = [];
  const canonicalEventType = readString(
    payload['canonical_event_type'] ?? payload['canonicalEventType'],
  );
  const provider = readProvider(payload, context);
  const providerSessionId = readProviderSessionId(payload, context);
  const routing = readRouting(payload);
  const toolUses = readToolUses(payload, observedAt);
  const toolResults = readToolResults(payload, observedAt);
  const commandLifecycle = readCommandLifecycle(payload, routing);

  if (canonicalEventType === 'permission_request' || payload['permission_request'] !== undefined) {
    const request = readPermissionRequest(payload, context, observedAt);
    if (request) {
      projected.push({
        run_id: input.run_id,
        actor: input.actor,
        event_type: 'agent_output',
        state_version: input.state_version,
        payload: {
          kind: 'permission_requested',
          provider,
          providerSessionId,
          routing,
          request,
        },
      });
    }
  }

  if (canonicalEventType === 'diff' || payload['files'] !== undefined || payload['diffs'] !== undefined) {
    const diff = readDiffFacts(payload, context, observedAt);
    if (diff && diff.authority !== 'diagnostic') {
      projected.push({
        run_id: input.run_id,
        actor: input.actor,
        event_type: 'agent_output',
        state_version: input.state_version,
        payload: { kind: 'diff', diff },
      });
    }
  }

  if (toolUses.length > 0) {
    projected.push({
      run_id: input.run_id,
      actor: input.actor,
      event_type: 'agent_output',
      state_version: input.state_version,
      payload: {
        kind: 'tool_use',
        provider,
        providerSessionId,
        routing,
        blocks: toolUses,
        commandLifecycle,
      },
    });
  }
  if (toolResults.length > 0) {
    projected.push({
      run_id: input.run_id,
      actor: input.actor,
      event_type: 'agent_output',
      state_version: input.state_version,
      payload: {
        kind: 'tool_result',
        provider,
        providerSessionId,
        routing,
        results: toolResults,
        commandLifecycle,
      },
    });
  }

  if (projected.length === 0) {
    const identity = providerIdentityEvent(input, context, payload, observedAt);
    if (identity) projected.push(identity);
  }
  return projected;
};

const projectLifecycleEvent = (
  input: DurableAdmissionEventInput,
  context: DurableAdmissionContext,
  payload: Record<string, unknown>,
  observedAt: string,
): DurableRunEventInput | null => {
  if (input.event_type === 'run_started') {
    const mode = payload['mode'] === 'resume' ? 'resume' : 'prompt';
    return {
      run_id: input.run_id,
      actor: input.actor,
      event_type: 'run_started',
      state_version: input.state_version,
      payload: {
        kind: 'run_started',
        mode,
        prompt: typeof payload['prompt'] === 'string' ? payload['prompt'] : '',
        adapterId: readString(payload['adapterId']) ?? 'legacy',
        repositoryPath: readString(payload['repositoryPath']) ?? context.repositoryPath ?? 'legacy',
        provider: context.provider,
        providerSessionId:
          readNullableString(payload['provider_session_id']) ?? context.providerSessionId,
        providerConversationId:
          readNullableString(payload['provider_conversation_id']) ?? context.providerConversationId,
        providerSessionAgentId: context.providerSessionAgentId,
        observedAt,
      },
    };
  }

  if (input.event_type === 'run_completed') {
    const errorCount = readNumber(payload['errorCount'] ?? payload['error_count']) ?? 0;
    const hasError =
      readString(payload['error']) !== null ||
      readString(payload['code']) !== null ||
      payload['terminalError'] !== undefined;
    return {
      run_id: input.run_id,
      actor: input.actor,
      event_type: 'run_completed',
      state_version: input.state_version,
      payload: {
        kind: 'run_completed',
        mode: payload['mode'] === 'resume' ? 'resume' : 'prompt',
        provider: context.provider,
        providerSessionId:
          readNullableString(payload['provider_session_id']) ?? context.providerSessionId,
        providerConversationId:
          readNullableString(payload['provider_conversation_id']) ?? context.providerConversationId,
        providerSessionAgentId: context.providerSessionAgentId,
        outcome: hasError ? 'failed' : 'succeeded',
        errorCode: readString(payload['code']),
        errorCount: Math.max(0, Math.trunc(errorCount)),
        observedAt,
      },
    };
  }
  return null;
};

const projectPermissionDecision = (
  input: DurableAdmissionEventInput,
  payload: Record<string, unknown>,
): DurableRunEventInput | null => {
  const requestId = readString(payload['requestId'] ?? payload['request_id']);
  const decidedAt = readString(payload['decidedAt'] ?? payload['decided_at']);
  if (!requestId || !decidedAt) return null;
  const rawDecision = readString(payload['decision']);
  const decision =
    rawDecision === 'deny'
      ? 'deny'
      : rawDecision === 'always_approve' || rawDecision === 'allow_always' || rawDecision === 'whitelist'
        ? 'allow_always'
        : rawDecision === 'approve' || rawDecision === 'allow'
          ? 'allow'
          : null;
  if (!decision) return null;
  return {
    run_id: input.run_id,
    actor: input.actor,
    event_type: 'post_processed',
    state_version: input.state_version,
    payload: {
      kind: 'permission_decision_recorded',
      requestId,
      decision,
      decidedAt,
      userId: readNullableString(payload['userId'] ?? payload['user_id']),
    },
  };
};

const projectTaskMonitorReceipt = (
  input: DurableAdmissionEventInput,
  payload: Record<string, unknown>,
): DurableRunEventInput | null => {
  const receipt = readNestedRecord(payload, ['taskMonitorConversationReceipt']);
  if (!receipt) return null;
  const sourceMessageId = readString(receipt['sourceMessageId']);
  const turnId = readString(receipt['turnId']);
  const rawOutcome = readString(receipt['terminalOutcome']);
  if (!sourceMessageId || !turnId || !rawOutcome) return null;
  const terminalOutcome =
    rawOutcome === 'COMPLETED' || rawOutcome === 'succeeded'
      ? 'succeeded'
      : rawOutcome === 'ABORTED' || rawOutcome === 'cancelled'
        ? 'cancelled'
        : rawOutcome === 'FAILED' || rawOutcome === 'failed'
          ? 'failed'
          : null;
  if (!terminalOutcome) return null;
  return {
    run_id: input.run_id,
    actor: input.actor,
    event_type: 'post_processed',
    state_version: input.state_version,
    payload: {
      kind: 'task_monitor_turn_settled',
      sourceMessageId,
      turnId,
      terminalOutcome,
      completedAssistantMessageId: readNullableString(receipt['completedAssistantMessageId']),
      reportIds: readArray(receipt['reportIds'])
        .map(readString)
        .filter((value): value is string => value !== null),
    },
  };
};

/**
 * Project one legacy/local envelope into the canonical records it is allowed
 * to author. Provider envelopes are read only long enough to extract typed
 * facts; the envelope itself is never returned to the durable store.
 */
export const projectAgenticEventToDurableEvents = (
  input: DurableAdmissionEventInput,
  context: DurableAdmissionContext,
  observedAt = new Date().toISOString(),
): DurableRunEventInput[] => {
  const appendInput: DurableAdmissionEventInput = {
    run_id: input.run_id,
    actor: input.actor,
    event_type: input.event_type,
    state_version: input.state_version,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
  const payload = isRecord(input.payload) ? input.payload : {};

  const lifecycle = projectLifecycleEvent(appendInput, context, payload, observedAt);
  if (lifecycle) return [lifecycle];

  if (input.event_type === 'agent_output') {
    const decision =
      payload['messageType'] === 'permission_decision' || payload['messageType'] === 'permission_decision_ui'
        ? projectPermissionDecision(appendInput, payload)
        : null;
    if (decision) return [decision];

    const receipt = projectTaskMonitorReceipt(appendInput, payload);
    if (receipt) return [receipt];

    const summary = readString(payload['summary']);
    if (summary) {
      try {
        const parsed: unknown = JSON.parse(summary);
        if (isRecord(parsed)) {
          const parsedReceipt = projectTaskMonitorReceipt(appendInput, parsed);
          if (parsedReceipt) return [parsedReceipt];
          const permission = projectProviderEvent(appendInput, context, parsed, observedAt);
          if (permission.length > 0) return permission;
        }
      } catch {
        // Assistant prose and malformed summaries are transient by design.
      }
    }
    if (payload['messageType'] === 'provider_event' || payload['canonical_event'] !== undefined) {
      return projectProviderEvent(appendInput, context, payload, observedAt);
    }
  }

  if (input.event_type === 'post_processed') {
    return projectTaskMonitorReceipt(appendInput, payload) ? [projectTaskMonitorReceipt(appendInput, payload)!] : [];
  }
  return [];
};

export const projectAgenticEventToDurableEvent = (
  input: DurableAdmissionEventInput,
  context: DurableAdmissionContext,
  observedAt?: string,
): DurableRunEventInput | null =>
  projectAgenticEventToDurableEvents(input, context, observedAt)[0] ?? null;
