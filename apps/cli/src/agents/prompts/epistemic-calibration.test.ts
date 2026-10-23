import { describe, expect, it } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import {
  gpt56EpistemicCalibration,
  selectGpt56EpistemicCalibration,
  type PlatformPromptContext,
} from './epistemic-calibration';

const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
const codexContextFor = (
  promptType: LocalPromptType,
  model: string | null,
): PlatformPromptContext => {
  const handler = registry.get(promptType);
  if (!handler) throw new Error(`No handler registered for ${promptType}.`);
  return {
    provider: 'codex',
    model,
    ...(handler.epistemicCalibration ? { epistemicCalibration: true as const } : {}),
  };
};

describe('selectGpt56EpistemicCalibration', () => {
  it.each(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'selects the tuned Codex variant for %s',
    (model) => {
      expect(
        selectGpt56EpistemicCalibration(codexContextFor(LocalPromptType.EntityConversation, model)),
      ).toBe(gpt56EpistemicCalibration);
    },
  );

  it.each([
    { provider: 'codex' as const, model: 'gpt-5.7' },
    { provider: 'codex' as const, model: 'unknown-model' },
    { provider: 'codex' as const, model: null },
    { provider: 'claude' as const, model: 'gpt-5.6-sol' },
    { provider: 'opencode' as const, model: 'gpt-5.6-sol' },
  ])('adds nothing for conversational context $provider/$model', ({ provider, model }) => {
    expect(
      selectGpt56EpistemicCalibration({
        ...codexContextFor(LocalPromptType.EntityConversation, model),
        provider,
      }),
    ).toBeNull();
  });

  it.each([
    LocalPromptType.StartupSession,
    LocalPromptType.PlanExecution,
    LocalPromptType.Implement,
  ])('excludes prompt type %s, which does not declare calibration', (promptType) => {
    expect(selectGpt56EpistemicCalibration(codexContextFor(promptType, 'gpt-5.6-sol'))).toBeNull();
  });

  it('keeps evidence reconciliation and grounded correction without the former response template', () => {
    expect(gpt56EpistemicCalibration).toContain('evidence');
    expect(gpt56EpistemicCalibration).toMatch(/runtime paths/i);
    expect(gpt56EpistemicCalibration).toMatch(/concurrency/i);
    expect(gpt56EpistemicCalibration).toMatch(/observation from inference/i);
    expect(gpt56EpistemicCalibration).toMatch(/overconfiden/i);
    expect(gpt56EpistemicCalibration).not.toContain('What was wrong');
    expect(gpt56EpistemicCalibration).not.toContain('What changed');
    expect(gpt56EpistemicCalibration).not.toContain('Patch');
  });
});
