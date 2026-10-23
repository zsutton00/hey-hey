#!/usr/bin/env tsx
/**
 * One-shot backfill script: reads persisted agent events from the session store
 * and posts them as messages to the platform API.
 *
 * Usage:
 *   HEYHEY_API_URL=http://localhost:3000 npx tsx src/scripts/backfill-messages.ts
 *
 * Optional env:
 *   HEYHEY_SESSION_DIR  — override default session data directory
 *   DRY_RUN=1           — log what would be posted without actually posting
 */

import { RunStore } from '../run-store/index';
import { resolveBaseDir } from '../session/paths';
import { OAuthClient } from '../auth/oauth-client';
import { extractOrganizationIdFromToken } from '../auth/index';
import { createUiCommonAuthAdapter } from '../auth/ui-common-auth-adapter';
import {
  createBrowserApiRuntime,
  registerApiRuntime,
  platformClient,
} from '@hey-hey/ui-common/clients';
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type CreateSystemMessage,
  type CreateUserMessage,
  type UserMessageData,
} from '../shared/api/index';
import { extractStructuredJsonPayload } from '../agents/response-parser';
import type { AgenticSessionEvent, AgenticSession } from '../session/types';

type BackfillSystemMessage = Omit<CreateSystemMessage, 'data' | 'status' | 'createdAt'> & {
  readonly status: MessageStatus;
  readonly createdAt: string;
  readonly data: {
    readonly type: typeof SystemMessageDataTypeEnum.Agent;
    readonly title: string;
    readonly response: string;
    readonly detectedIntent: string;
    readonly intentConfidence: number;
    readonly ragEnabled: boolean;
  };
};

const buildBackfillAgentMessage = (
  text: string,
  projectId: string,
  conversationId: string,
  timestamp: string,
  parentMessageId: string | null,
): BackfillSystemMessage | null => {
  const normalized = text.trim();
  if (normalized.length === 0) return null;

  // Check if it looks like a daily session or task refiner JSON response
  const payload = extractStructuredJsonPayload(normalized);
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const response = typeof obj['response'] === 'string' ? obj['response'].trim() : null;
        if (response) {
          const systemData = {
            type: SystemMessageDataTypeEnum.Agent,
            title: 'Response',
            response,
            detectedIntent: 'agent_response',
            intentConfidence: 1.0,
            ragEnabled: false,
          } satisfies BackfillSystemMessage['data'];
          return {
            projectId,
            type: MessageType.System,
            status: MessageStatus.Completed,
            conversationId,
            data: systemData,
            createdAt: timestamp,
            ...(parentMessageId ? { parentMessageId } : {}),
          };
        }
      }
    } catch {
      // Not JSON — fall through to plain text
    }
  }

  const systemData = {
    type: SystemMessageDataTypeEnum.Agent,
    title: 'Execution Update',
    response: normalized,
    detectedIntent: 'agent_response',
    intentConfidence: 1.0,
    ragEnabled: false,
  } satisfies BackfillSystemMessage['data'];
  return {
    projectId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    conversationId,
    data: systemData,
    createdAt: timestamp,
    ...(parentMessageId ? { parentMessageId } : {}),
  };
};

const buildBackfillUserMessage = (
  prompt: string,
  userId: string,
  projectId: string,
  conversationId: string,
  timestamp: string,
  parentMessageId: string | null,
): CreateUserMessage | null => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  const userData: UserMessageData = { comment: trimmed };
  return {
    projectId,
    type: MessageType.User,
    userId,
    status: MessageStatus.Completed,
    conversationId,
    data: userData,
    createdAt: timestamp,
    ...(parentMessageId ? { parentMessageId } : {}),
  };
};

const DRY_RUN = process.env['DRY_RUN'] === '1';
const TARGET_SESSION = process.env['TARGET_SESSION']?.trim() || null;

const log = (message: string, data?: Record<string, unknown>): void => {
  const parts = [new Date().toISOString(), message];
  if (data) parts.push(JSON.stringify(data));
  console.log(parts.join(' | '));
};

const isSystemMessage = (
  message: BackfillSystemMessage | CreateUserMessage,
): message is BackfillSystemMessage => message.type === MessageType.System;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractPersistedMessageId = (response: unknown): string | null => {
  if (!isRecord(response)) return null;
  const data = isRecord(response['data']) ? response['data'] : null;
  const inner = data && isRecord(data['data']) ? data['data'] : null;
  const id = inner?.['id'];
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
};

const resolveConversationIds = async (
  organizationId: string,
  projectId: string,
  agentSessionId: string,
): Promise<{ conversationId: string; existingMessageCount: number } | null> => {
  const response = await platformClient.getWorkflowConversations({
    organizationId,
    projectId,
    workflowName: 'agent-session',
    workflowAboutId: agentSessionId,
    page: 1,
    limit: 1,
  });

  const conversations = (response as unknown as { data?: { data?: { data?: unknown[] } } })?.data
    ?.data?.data;
  if (!Array.isArray(conversations) || conversations.length === 0) return null;

  const conversation = conversations[0];
  if (!isRecord(conversation)) return null;

  const conversationId = typeof conversation['id'] === 'string' ? conversation['id'].trim() : '';

  if (!conversationId) return null;
  const messages = Array.isArray(conversation['messages']) ? conversation['messages'] : [];
  return { conversationId, existingMessageCount: messages.length };
};

const backfillSession = async (
  organizationId: string,
  agenticSession: AgenticSession,
  events: AgenticSessionEvent[],
): Promise<{ posted: number; skipped: number; errors: number }> => {
  const projectId = agenticSession.contextMetadata?.projectId;
  if (!projectId) {
    log('SKIP: no projectId', { sessionId: agenticSession.agentic_session_id });
    return { posted: 0, skipped: events.length, errors: 0 };
  }

  const agentSessionId = agenticSession.contextMetadata?.agentSessionId;
  if (!agentSessionId) {
    log('SKIP: no agentSessionId', {
      sessionId: agenticSession.agentic_session_id,
    });
    return { posted: 0, skipped: events.length, errors: 0 };
  }

  const conversationIds = await resolveConversationIds(organizationId, projectId, agentSessionId);
  if (!conversationIds) {
    log('SKIP: no conversation found', {
      sessionId: agenticSession.agentic_session_id,
      agentSessionId,
    });
    return { posted: 0, skipped: events.length, errors: 0 };
  }

  if (!TARGET_SESSION && conversationIds.existingMessageCount > 0) {
    log('SKIP: conversation already has messages', {
      sessionId: agenticSession.agentic_session_id,
      agentSessionId,
      conversationId: conversationIds.conversationId,
      existingMessageCount: conversationIds.existingMessageCount,
    });
    return { posted: 0, skipped: events.length, errors: 0 };
  }

  log('BACKFILL', {
    sessionId: agenticSession.agentic_session_id,
    agentSessionId,
    conversationId: conversationIds.conversationId,
    totalEvents: events.length,
  });

  let posted = 0;
  let skipped = 0;
  let errors = 0;
  let parentMessageId: string | null = null;

  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : null;
    if (!payload) {
      skipped++;
      continue;
    }

    let messageDto: BackfillSystemMessage | CreateUserMessage | null = null;

    if (event.event_type === 'run_started') {
      const prompt = typeof payload['prompt'] === 'string' ? payload['prompt'].trim() : '';
      if (prompt) {
        messageDto = buildBackfillUserMessage(
          prompt,
          'system',
          projectId,
          conversationIds.conversationId,
          event.ts,
          parentMessageId,
        );
      }
    } else if (event.event_type === 'agent_output' && event.actor === 'agent') {
      const messageType = typeof payload['messageType'] === 'string' ? payload['messageType'] : '';
      const summary = typeof payload['summary'] === 'string' ? payload['summary'].trim() : '';

      if (summary && messageType === 'assistant') {
        messageDto = buildBackfillAgentMessage(
          summary,
          projectId,
          conversationIds.conversationId,
          event.ts,
          parentMessageId,
        );
      } else if (summary && messageType === 'user') {
        messageDto = buildBackfillUserMessage(
          summary,
          'system',
          projectId,
          conversationIds.conversationId,
          event.ts,
          parentMessageId,
        );
      }
    }

    if (!messageDto) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      log('DRY_RUN: would post', {
        eventType: event.event_type,
        messageType: messageDto.type,
        seq: event.seq,
      });
      posted++;
      continue;
    }

    try {
      if (!isSystemMessage(messageDto)) {
        throw new Error(
          'Backfill only supports system messages under the current post-message contract.',
        );
      }
      const { type: _messageType, ...messageBody } = messageDto;
      const response = await platformClient.postMessage({
        organizationId,
        projectId,
        postMessageRequest: {
          type: 'SYSTEM',
          projectId: messageBody.projectId,
          status: messageBody.status,
          conversationId: messageBody.conversationId,
          createdAt: messageBody.createdAt,
          ...(messageBody.parentMessageId !== undefined
            ? { parentMessageId: messageBody.parentMessageId }
            : {}),
          data: {
            type: 'AGENT',
            title: messageBody.data.title,
            response: messageBody.data.response,
            detectedIntent: messageBody.data.detectedIntent,
            intentConfidence: messageBody.data.intentConfidence,
            ragEnabled: messageBody.data.ragEnabled,
          },
        },
      });
      const persistedId = extractPersistedMessageId(response);
      if (persistedId) {
        parentMessageId = persistedId;
      }
      posted++;
      log('POSTED', {
        seq: event.seq,
        eventType: event.event_type,
        messageType: messageDto.type,
        persistedId: persistedId ?? undefined,
      });
    } catch (error) {
      errors++;
      log('ERROR', {
        seq: event.seq,
        eventType: event.event_type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { posted, skipped, errors };
};

const main = async (): Promise<void> => {
  log('Starting backfill', { dryRun: DRY_RUN, dataDir: resolveBaseDir() });

  // Initialize API runtime
  const apiBaseUrl = process.env['HEYHEY_API_URL']?.trim() || 'http://localhost:3000';
  const normalizedApiBaseUrl = apiBaseUrl.endsWith('/api/v1')
    ? apiBaseUrl
    : `${apiBaseUrl.replace(/\/$/u, '')}/api/v1`;

  const oauthClient = new OAuthClient();
  const authAdapter = createUiCommonAuthAdapter(oauthClient);
  const apiRuntime = createBrowserApiRuntime({
    baseUrl: normalizedApiBaseUrl,
    authAdapter,
  });
  registerApiRuntime(apiRuntime);
  log('API runtime registered', { apiBaseUrl: normalizedApiBaseUrl });

  // Resolve organization ID from token
  const tokenResult = await oauthClient.getAccessToken({});
  if (!tokenResult.success) {
    log('FATAL: failed to get access token');
    process.exit(1);
  }
  const organizationId = extractOrganizationIdFromToken(tokenResult.data);
  if (!organizationId) {
    log('FATAL: could not extract organization ID from token');
    process.exit(1);
  }
  log('Resolved organization', { organizationId });

  // Load runs
  const runStore = new RunStore();
  await runStore.initialize();
  const runs = await runStore.listRuns();

  log('Loaded runs', {
    runCount: runs.length,
  });

  let totalPosted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const run of runs) {
    if (TARGET_SESSION && run.agentic_session_id !== TARGET_SESSION) {
      continue;
    }
    const agenticSession = await runStore.getRunWithEvents(run.agentic_session_id);
    if (!agenticSession) {
      continue;
    }
    const events = agenticSession.events ?? [];
    if (events.length === 0) {
      log('SKIP: no events', { sessionId: agenticSession.agentic_session_id });
      continue;
    }

    const result = await backfillSession(organizationId, agenticSession, events);
    totalPosted += result.posted;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  log('Backfill complete', {
    totalPosted,
    totalSkipped,
    totalErrors,
    dryRun: DRY_RUN,
  });
};

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
