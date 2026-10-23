import type { AgentAdapterId } from "../core";

export interface AgentInvocationRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterRatio: number;
}

export type AgentInvocationRetryPolicyOverrides = Partial<
  Record<AgentAdapterId, Partial<AgentInvocationRetryPolicy>>
>;

export const DEFAULT_AGENT_INVOCATION_RETRY_POLICY: AgentInvocationRetryPolicy =
  {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    multiplier: 2,
    jitterRatio: 0.2,
  };

export const KNOWN_AGENT_INVOCATION_RETRY_POLICIES: Readonly<
  Record<string, AgentInvocationRetryPolicy>
> = {
  claude: {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    multiplier: 2,
    jitterRatio: 0.2,
  },
  codex: {
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    multiplier: 2,
    jitterRatio: 0.2,
  },
};

const clampRetryPolicy = (
  candidate: AgentInvocationRetryPolicy
): AgentInvocationRetryPolicy => ({
  maxAttempts: Math.max(1, Math.floor(candidate.maxAttempts)),
  initialDelayMs: Math.max(0, Math.floor(candidate.initialDelayMs)),
  maxDelayMs: Math.max(0, Math.floor(candidate.maxDelayMs)),
  multiplier: Math.max(1, candidate.multiplier),
  jitterRatio: Math.max(0, Math.min(1, candidate.jitterRatio)),
});

export const resolveAgentInvocationRetryPolicy = (
  adapterId: AgentAdapterId,
  overrides?: AgentInvocationRetryPolicyOverrides
): AgentInvocationRetryPolicy => {
  const adapterOverrides = overrides?.[adapterId] ?? {};
  const adapterDefaults =
    KNOWN_AGENT_INVOCATION_RETRY_POLICIES[adapterId] ??
    DEFAULT_AGENT_INVOCATION_RETRY_POLICY;
  return clampRetryPolicy({
    ...adapterDefaults,
    ...adapterOverrides,
  });
};

export const computeAgentRetryDelayMs = (
  attempt: number,
  policy: AgentInvocationRetryPolicy
): number => {
  const exponential =
    policy.initialDelayMs *
    Math.pow(policy.multiplier, Math.max(0, attempt - 1));
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio;
  const lower = Math.max(0, capped - jitter);
  const upper = capped + jitter;
  return Math.round(lower + Math.random() * (upper - lower));
};

export const waitForRetryDelay = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
