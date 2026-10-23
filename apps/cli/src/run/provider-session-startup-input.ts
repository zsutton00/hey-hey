import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';

export type ProviderSessionDecision =
  | 'agent-transition-mint'
  | 'unowned-session-mint'
  | 'explicit-fresh-mint'
  | 'first-turn-mint'
  | 'per-turn-mint'
  | 'resume';

type ProviderSessionStartupAction = 'mint' | 'remint' | 'resume';

export interface ProviderSessionStartupSegments {
  readonly stableInstructions: string;
  readonly dynamicContext: string;
  readonly userInput: string;
}

/** The reusable portion of a handler's cache-aware prompt projection. */
export interface CachedProviderSessionStartupSegments {
  readonly promptType: string;
  readonly stableInstructions: string;
}

type ProviderSessionPromptInput =
  | { readonly kind: 'turn'; readonly prompt: string }
  | { readonly kind: 'startup'; readonly segments: ProviderSessionStartupSegments };

export interface ProviderSessionStartupProjection {
  readonly action: ProviderSessionStartupAction;
  readonly delivered: boolean;
  readonly input: ProviderSessionPromptInput;
}

/**
 * Classify the provider-session lifecycle without mutating the Run. Run uses
 * this preview before prompt composition so entity Context can be refreshed
 * before the new session's startup block is rendered; it repeats the same
 * classification after preparation when it performs the discard/mint action.
 */
export const classifyProviderSessionDecision = (args: {
  hasProviderSession: boolean;
  outgoingAgentId: string | null;
  incomingAgentId: string;
  providerSessionStart: 'inherit' | 'fresh';
  providerSessionLifetime?: 'run' | 'turn';
  preparedWorkspaceBoundaryChanged?: boolean;
  providerSwitched?: boolean;
}): ProviderSessionDecision => {
  const hasUnownedProviderSession = args.hasProviderSession && !args.outgoingAgentId;
  const isAgentTransition =
    args.hasProviderSession &&
    args.outgoingAgentId !== null &&
    args.outgoingAgentId !== args.incomingAgentId;
  const requiresExplicitFresh =
    args.hasProviderSession &&
    (args.providerSessionStart === 'fresh' ||
      args.preparedWorkspaceBoundaryChanged === true ||
      args.providerSwitched === true);

  if (hasUnownedProviderSession) return 'unowned-session-mint';
  if (isAgentTransition) return 'agent-transition-mint';
  if (requiresExplicitFresh) return 'explicit-fresh-mint';
  if (!args.hasProviderSession) {
    return args.providerSessionLifetime === 'turn' ? 'per-turn-mint' : 'first-turn-mint';
  }
  return 'resume';
};

const startupActionFor = (decision: ProviderSessionDecision): ProviderSessionStartupAction => {
  if (decision === 'resume') return 'resume';
  return decision === 'first-turn-mint' ? 'mint' : 'remint';
};

export const projectProviderSessionStartupInput = (args: {
  decision: ProviderSessionDecision;
  prompt: string;
  startupPromptInput: AgentStartupPromptInputResult | null;
  promptSegments?: ProviderSessionStartupSegments;
}): ProviderSessionStartupProjection => {
  const action = startupActionFor(args.decision);
  if (action === 'resume' || args.startupPromptInput === null) {
    return { action, delivered: false, input: { kind: 'turn', prompt: args.prompt } };
  }

  if (args.promptSegments) {
    return {
      action,
      delivered: true,
      input: {
        kind: 'startup',
        segments: {
          stableInstructions: args.promptSegments.stableInstructions,
          dynamicContext: [
            args.startupPromptInput.renderedInput,
            args.promptSegments.dynamicContext,
          ]
            .filter((value) => value.length > 0)
            .join('\n\n---\n\n'),
          userInput: args.promptSegments.userInput,
        },
      },
    };
  }

  return {
    action,
    delivered: true,
    input: {
      kind: 'turn',
      prompt: `${args.startupPromptInput.renderedInput}\n\n---\n\n${args.prompt}`,
    },
  };
};
