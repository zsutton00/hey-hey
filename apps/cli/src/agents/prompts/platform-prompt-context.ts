import type { PromptTypeHandler } from '../prompt-type-handler';
import type { AgentProviderId } from '../providers/provider-config';

/**
 * The guidance a handler declares it receives in its provider session's
 * platform system prompt. Composed once per provider session, never per Turn.
 */
export type SessionPromptDeclarations = Pick<
  PromptTypeHandler<unknown>,
  'graphResearchGuidance' | 'epistemicCalibration'
>;

/** The session facts the platform system prompt is composed from. */
export interface PlatformPromptContext extends SessionPromptDeclarations {
  provider: AgentProviderId;
  model: string | null;
}

/** Copies only a handler's prompt declarations, for runners that receive them as input. */
export const sessionPromptDeclarationsOf = (
  handler: SessionPromptDeclarations,
): SessionPromptDeclarations => ({
  ...(handler.graphResearchGuidance ? { graphResearchGuidance: true as const } : {}),
  ...(handler.epistemicCalibration ? { epistemicCalibration: true as const } : {}),
});
