import { describe, expect, it } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import { graphResearchGuidance, selectGraphResearchGuidance } from './graph-research';

const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
const handlerFor = (promptType: LocalPromptType) => {
  const handler = registry.get(promptType);
  if (!handler) throw new Error(`No handler registered for ${promptType}.`);
  return handler;
};

describe('selectGraphResearchGuidance', () => {
  it.each([LocalPromptType.EntityConversation, LocalPromptType.FreeForm, LocalPromptType.Research])(
    'selects the reusable fragment for conversational prompt type %s',
    (promptType) =>
      expect(selectGraphResearchGuidance(handlerFor(promptType))).toBe(graphResearchGuidance),
  );

  it.each([
    LocalPromptType.ProjectAssistant,
    LocalPromptType.StartupSession,
    LocalPromptType.PlanExecution,
    LocalPromptType.Implement,
  ])('excludes bootstrap and execution prompt type %s', (promptType) => {
    expect(selectGraphResearchGuidance(handlerFor(promptType))).toBeNull();
  });

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
