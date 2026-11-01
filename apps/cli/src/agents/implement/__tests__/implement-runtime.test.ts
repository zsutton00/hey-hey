import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../../../run-store';
import type { CreateAgenticSessionInput } from '../../../session/types';
import type { PromptTypeHandler } from '../../prompt-type-handler';
import type { LocalImplementPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import { implementHandler } from '../implement.handler';
import { resolveTurnEffective } from '../../../turn/turn-effective';
import {
  toRunPromptRequest,
  validateConversationTrigger,
} from '../../../server/trigger-verification/dispatch';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

let root: string;
let store: RunStore;
const paths = () => ({
  baseDir: root,
  runsDir: path.join(root, 'runs'),
  indexPath: path.join(root, 'runs/index.json'),
  preferencesPath: path.join(root, 'preferences.json'),
});
const sessionInput = (runId = 'planning', provider = 'codex'): CreateAgenticSessionInput => ({
  agentic_session_id: runId,
  provider,
  provider_session_id: `pending_${runId}`,
  provider_conversation_id: null,
  conversationId: 'conversation',
  entity: { entityType: 'TASK', entityId: '10000000-0000-4000-8000-000000000001' },
  services: [],
  model: 'planning-model',
  reasoningEffort: 'high',
  fastMode: true,
  contextMetadata: {
    organizationId: 'organization',
    projectId: 'project',
    capturedAt: new Date().toISOString(),
    agentSessionId: 'session',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'implement-runtime-'));
  store = new RunStore({ paths: paths() });
  await store.initialize();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('approved implementation runtime', () => {
  it.each([true, false, undefined])(
    'preserves fast mode %s through validated mapping, persistence and follow-ups',
    async (fastMode) => {
      const initial = await store.createRun(sessionInput());
      const runtime = {
        provider: 'codex' as const,
        model: 'gpt-6.1-sol',
        reasoningEffort: 'low' as const,
        ...(fastMode !== undefined ? { fastMode } : {}),
      };
      const input = toRunPromptRequest(
        validateConversationTrigger(
          {
            promptType: 'implement',
            nodeId: 'implement',
            triggerMessageId: 'message',
            payload: { runtime },
          },
          promptTypeRegistry,
        ),
      );
      const updated = await store.updateRunRuntime(
        initial.agentic_session_id,
        implementHandler.resolveRuntime!(input.payload as LocalImplementPromptPayload)!,
      );
      const effective = resolveTurnEffective(
        { promptType: 'implement' } as PromptTypeHandler<unknown>,
        updated,
      );
      expect(effective).toEqual({ model: 'gpt-6.1-sol', reasoningEffort: 'low' });
      expect(updated.fastMode).toBe(fastMode);
      const reopened = new RunStore({ paths: paths() });
      await reopened.initialize();
      const persisted = (await reopened.getRun('planning'))!;
      expect(persisted.model).toBe('gpt-6.1-sol');
      expect(persisted.fastMode).toBe(fastMode);
      expect(implementHandler.resolveRuntime!({ userMessage: 'Continue' })).toBeUndefined();
      expect(persisted.reasoningEffort).toBe('low');
      expect(persisted.provider_session_id).toBe(initial.provider_session_id);
    },
  );

  it('keeps current settings without an approval selection', () => {
    expect(implementHandler.resolveRuntime!({})).toBeUndefined();
  });

  it('switches the provider inside the existing Run', async () => {
    const initial = await store.createRun(sessionInput('session', 'claude'));
    const updated = await store.updateRunRuntime('session', {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
    });
    expect(updated.agentic_session_id).toBe('session');
    expect(updated.provider).toBe('codex');
    expect(updated.model).toBe('gpt-6.1-sol');
    const reopened = new RunStore({ paths: paths() });
    await reopened.initialize();
    expect((await reopened.getRun('session'))!.provider).toBe('codex');
    expect(reopened.lookupByAgentSessionId('session')).toBe('session');
    expect(reopened.lookupByConversationId('conversation')).toBe('session');
    expect(await reopened.listRuns()).toHaveLength(1);
  });
});
