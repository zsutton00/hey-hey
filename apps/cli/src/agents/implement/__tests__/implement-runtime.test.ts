import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../../../run-store';
import type { CreateAgenticSessionInput } from '../../../session/types';
import type { PromptTypeHandler } from '../../prompt-type-handler';
import { ImplementRuntimeOwner } from '../implement-runtime-owner';
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
      const owner = new ImplementRuntimeOwner(store);
      const updated = await owner.apply(initial, input);
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
      const followUp = await owner.apply(persisted, {
        promptType: 'implement',
        payload: { userMessage: 'Continue' },
        references: { resolved: [], unresolved: [] },
      });
      expect(followUp).toBe(persisted);
      expect(followUp.reasoningEffort).toBe('low');
      expect(followUp.provider_session_id).toBe(initial.provider_session_id);
    },
  );

  it('keeps current settings without an approval selection', async () => {
    const initial = await store.createRun(sessionInput());
    expect(
      await new ImplementRuntimeOwner(store).apply(
        initial,
        toRunPromptRequest(
          validateConversationTrigger(
            {
              promptType: 'implement',
              nodeId: 'implement',
              triggerMessageId: 'message',
            },
            promptTypeRegistry,
          ),
        ),
      ),
    ).toBe(initial);
  });

  it('switches the provider inside the existing Run', async () => {
    const initial = await store.createRun(sessionInput('session', 'claude'));
    const updated = await new ImplementRuntimeOwner(store).apply(
      initial,
      toRunPromptRequest(
        validateConversationTrigger(
          {
            promptType: 'implement',
            nodeId: 'implement',
            triggerMessageId: 'message',
            payload: {
              runtime: {
                provider: 'codex',
                model: 'gpt-6.1-sol',
                reasoningEffort: 'low',
                fastMode: false,
              },
            },
          },
          promptTypeRegistry,
        ),
      ),
    );
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
