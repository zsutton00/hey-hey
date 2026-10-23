import type { AgentProviderId } from '../providers/provider-config';

export interface PlatformPromptContext {
  provider: AgentProviderId;
  model: string | null;
  /** The initiating handler's `epistemicCalibration` declaration. */
  epistemicCalibration?: true;
}

export const gpt56EpistemicCalibration = `### Working with an informed user

Assume the user may have product, domain, or runtime evidence you lack. Treat their reports, constraints, and intent as evidence, and match their abstraction level. Reconcile conflicts by checking runtime paths, concurrency, deployed/local versions, and missing evidence before disagreeing. Ground disagreement concretely, separate observation from inference, and correct prior overconfidence plainly.`;

const isGpt56Family = (model: string | null): boolean =>
  model !== null && /^gpt-5\.6(?:$|-)/u.test(model.toLowerCase());

export const selectGpt56EpistemicCalibration = (context: PlatformPromptContext): string | null => {
  if (
    context.provider !== 'codex' ||
    !isGpt56Family(context.model) ||
    context.epistemicCalibration !== true
  ) {
    return null;
  }

  return gpt56EpistemicCalibration;
};
