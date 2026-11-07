import { describe, expect, it } from 'vitest';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import type { PromptTypeHandler } from '../prompt-type-handler';
import workItemTypesFixture from './__fixtures__/work-item-types.fixture';
import { buildPlatformSystemPrompt } from './common';
import { graphResearchGuidance } from './graph-research';
import { sessionPromptDeclarationsOf } from './platform-prompt-context';

const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
const handlerFor = (promptType: LocalPromptType) => {
  const handler = registry.get(promptType);
  if (!handler) throw new Error(`No handler registered for ${promptType}.`);
  return handler;
};

const builtInTypes = workItemTypesFixture.map((summary) => summary.definition);

/** The platform system prompt a fresh provider session for this handler receives. */
const sessionSystemPromptFor = (handler: PromptTypeHandler<unknown>): string =>
  buildPlatformSystemPrompt(builtInTypes, {
    provider: 'claude',
    model: null,
    ...sessionPromptDeclarationsOf(handler),
  });

const occurrences = (prompt: string): number =>
  prompt.split('## Widening graph research').length - 1;

describe('graph research guidance delivery', () => {
  it.each(registry.list().map((handler) => [handler.id, handler] as const))(
    'reaches %s once exactly when the handler declares it',
    (_id, handler) => {
      const expected = handler.graphResearchGuidance ? 1 : 0;
      expect(occurrences(sessionSystemPromptFor(handler))).toBe(expected);
    },
  );

  it.each([LocalPromptType.EntityConversation, LocalPromptType.FreeForm, LocalPromptType.Research])(
    'is declared by conversational prompt type %s',
    (promptType) => expect(handlerFor(promptType).graphResearchGuidance).toBe(true),
  );

  it.each([
    LocalPromptType.ProjectAssistant,
    LocalPromptType.StartupSession,
    LocalPromptType.PlanExecution,
    LocalPromptType.Implement,
  ])('is not declared by bootstrap and execution prompt type %s', (promptType) => {
    expect(handlerFor(promptType).graphResearchGuidance).toBeUndefined();
  });
});

describe('graph research guidance text', () => {
  it('contains bounded discovery and proportional evidence guidance', () => {
    expect(graphResearchGuidance).toContain('During the conversation');
    expect(graphResearchGuidance).toContain(
      'initial orientation, not as a closed research boundary',
    );
    expect(graphResearchGuidance).toContain('introduces a new area');
    expect(graphResearchGuidance).toContain('Search for the concrete operation');
    expect(graphResearchGuidance).toContain('owning feature and relevant topology');
    expect(graphResearchGuidance).toContain('refine it with terminology learned');
    expect(graphResearchGuidance).toContain('search the relevant tasks and prior implementation');
    expect(graphResearchGuidance).toContain('Features describe what is delivered');
    expect(graphResearchGuidance).toContain('how related work was implemented before');
    expect(graphResearchGuidance).toContain('If relevant evidence still cannot be found');
    expect(graphResearchGuidance).toContain('no supplied Service association');
    expect(graphResearchGuidance).toContain('leading indicator');
    expect(graphResearchGuidance).toContain('do not infer ownership from the reporting');
    expect(graphResearchGuidance).toContain('established facts, reasonable inferences');
    expect(graphResearchGuidance).toContain('rather than presenting assumptions');
  });
});
