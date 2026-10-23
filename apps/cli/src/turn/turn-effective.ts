/**
 * Resolve the effective model + reasoning effort for one Turn.
 *
 * Precedence: the session's explicit user selection wins. A model is never
 * filled in from a handler: a Turn that names none launches the first model its
 * provider reports. The reasoning-effort default is a fallback for surfaces that
 * have not wired a ModelSelector and so carry no explicit selection.
 * The session value is already the resolved user intent (request → global,
 * encoded at create-run time by `run.service.ts` resolvedModel/resolvedEffort).
 * See Agent Sessions feature requirement: explicit user selection must survive
 * into the Turn so the model the user chose is the model that runs.
 */

import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import type { AgenticSession } from '../session/types';
import type { LocalReasoningEffort } from '../shared/agent-bridge-contract/index';

export interface TurnEffective {
  model: string | null;
  reasoningEffort: LocalReasoningEffort | null;
}

export const resolveTurnEffective = (
  handler: PromptTypeHandler<unknown>,
  session: AgenticSession,
): TurnEffective => ({
  model: session.model ?? null,
  reasoningEffort: session.reasoningEffort ?? handler.defaultReasoningEffort ?? null,
});
