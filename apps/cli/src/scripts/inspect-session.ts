#!/usr/bin/env tsx
import { RunStore } from '../run-store/index';
import { OAuthClient } from '../auth/oauth-client';
import { extractOrganizationIdFromToken } from '../auth/index';
import { createUiCommonAuthAdapter } from '../auth/ui-common-auth-adapter';
import {
  createBrowserApiRuntime,
  registerApiRuntime,
  platformClient,
} from '../../../../packages/ui-common/src/clients/shared';

const targetAgentSessionId = process.argv[2];
if (!targetAgentSessionId) {
  console.error('Usage: npx tsx src/scripts/inspect-session.ts <agentSessionId>');
  process.exit(1);
}

const main = async (): Promise<void> => {
  const store = new RunStore();
  await store.initialize();
  const runs = await store.listRuns();

  const entry = runs.find((s) => s.contextMetadata?.agentSessionId === targetAgentSessionId);

  if (!entry) {
    console.log('Run not found for agentSessionId:', targetAgentSessionId);
    return;
  }

  const withEvents = await store.getRunWithEvents(entry.agentic_session_id);
  const projectId = entry.contextMetadata?.projectId;
  console.log('agenticSessionId:', entry.agentic_session_id);
  console.log('projectId:', projectId);
  console.log('conversationId:', entry.conversationId);
  console.log('events:', withEvents?.events?.length ?? 0);

  if (!projectId) {
    console.log('No projectId — cannot look up conversation.');
    return;
  }

  // Init API
  const apiBaseUrl = process.env['HEYHEY_API_URL']?.trim() || 'http://localhost:3000';
  const normalizedApiBaseUrl = apiBaseUrl.endsWith('/api/v1')
    ? apiBaseUrl
    : `${apiBaseUrl.replace(/\/$/u, '')}/api/v1`;
  const oauthClient = new OAuthClient();
  const authAdapter = createUiCommonAuthAdapter(oauthClient);
  registerApiRuntime(createBrowserApiRuntime({ baseUrl: normalizedApiBaseUrl, authAdapter }));

  const tokenResult = await oauthClient.getAccessToken({});
  if (!tokenResult.success) {
    console.log('Auth failed');
    return;
  }
  const orgId = extractOrganizationIdFromToken(tokenResult.data);
  console.log('organizationId:', orgId);

  if (!orgId) return;

  // Try the conversation lookup
  console.log('\n--- Conversation lookup via getWorkflowConversations ---');
  try {
    const resp = await platformClient.getWorkflowConversations({
      organizationId: orgId,
      projectId,
      workflowName: 'agent-session',
      workflowAboutId: targetAgentSessionId,
      page: 1,
      limit: 10,
    });
    const conversations = (resp as unknown as { data?: { data?: { data?: unknown[] } } })?.data
      ?.data?.data;
    console.log('conversations found:', Array.isArray(conversations) ? conversations.length : 0);
    if (Array.isArray(conversations)) {
      for (const c of conversations) {
        console.log(JSON.stringify(c, null, 2));
      }
    } else {
      console.log(
        'raw response.data:',
        JSON.stringify((resp as unknown as { data?: unknown }).data, null, 2).slice(0, 500),
      );
    }
  } catch (err) {
    console.error('Lookup failed:', err);
  }
};

main().catch(console.error);
