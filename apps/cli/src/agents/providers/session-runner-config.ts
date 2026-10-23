import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProfileDataDir } from '../../session/paths';
import type {
  AgentInvocationRetryPolicy,
  AgentInvocationRetryPolicyOverrides,
  NormalizedAgentErrorVerbosity,
} from '../../agent-runtime/index';
import type { LocalReasoningEffort } from '../../shared/agent-bridge-contract/contract';

const DEFAULT_CONFIG_FILE_NAME = 'agent-invocation.json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const asVerbosity = (value: unknown): NormalizedAgentErrorVerbosity | undefined => {
  if (value === 'compact' || value === 'detailed') {
    return value;
  }
  return undefined;
};

const VALID_REASONING_EFFORTS = new Set<string>(['low', 'medium', 'high']);

const asReasoningEffort = (value: unknown): LocalReasoningEffort | undefined => {
  if (typeof value === 'string' && VALID_REASONING_EFFORTS.has(value)) {
    return value as LocalReasoningEffort;
  }
  return undefined;
};

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const sanitizeRetryPolicy = (value: unknown): Partial<AgentInvocationRetryPolicy> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate: Partial<AgentInvocationRetryPolicy> = {};
  const maxAttempts = asFiniteNumber(value['maxAttempts']);
  if (maxAttempts !== undefined) {
    candidate.maxAttempts = maxAttempts;
  }

  const initialDelayMs = asFiniteNumber(value['initialDelayMs']);
  if (initialDelayMs !== undefined) {
    candidate.initialDelayMs = initialDelayMs;
  }

  const maxDelayMs = asFiniteNumber(value['maxDelayMs']);
  if (maxDelayMs !== undefined) {
    candidate.maxDelayMs = maxDelayMs;
  }

  const multiplier = asFiniteNumber(value['multiplier']);
  if (multiplier !== undefined) {
    candidate.multiplier = multiplier;
  }

  const jitterRatio = asFiniteNumber(value['jitterRatio']);
  if (jitterRatio !== undefined) {
    candidate.jitterRatio = jitterRatio;
  }

  return Object.keys(candidate).length > 0 ? candidate : undefined;
};

const sanitizeRetryPolicies = (value: unknown): AgentInvocationRetryPolicyOverrides | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: AgentInvocationRetryPolicyOverrides = {};
  for (const [adapterId, policy] of Object.entries(value)) {
    const sanitized = sanitizeRetryPolicy(policy);
    if (!sanitized) {
      continue;
    }
    result[adapterId] = sanitized;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const resolveBaseDir = (): string => {
  if (process.env['HEYHEY_CONFIG_DIR']) {
    return process.env['HEYHEY_CONFIG_DIR'];
  }
  return resolveProfileDataDir();
};

export const resolveAgentInvocationConfigPath = (): string => {
  if (process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH']) {
    return process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH'];
  }
  return path.join(resolveBaseDir(), DEFAULT_CONFIG_FILE_NAME);
};

interface ParsedRunnerConfig {
  errorVerbosity?: NormalizedAgentErrorVerbosity;
  retryPolicies?: AgentInvocationRetryPolicyOverrides;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
}

const parseRunnerConfig = (value: unknown): ParsedRunnerConfig => {
  if (!isRecord(value)) {
    return {};
  }

  const nested =
    isRecord(value['agentInvocation']) && value['agentInvocation']
      ? value['agentInvocation']
      : value;

  const errorVerbosity = asVerbosity(nested['errorVerbosity']);
  const retryPolicies = sanitizeRetryPolicies(nested['retryPolicies']);
  const model = asTrimmedString(nested['model']);
  const reasoningEffort = asReasoningEffort(nested['reasoningEffort']);

  return {
    ...(errorVerbosity ? { errorVerbosity } : {}),
    ...(retryPolicies ? { retryPolicies } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
};

export interface AgentSessionRunnerConfig {
  sourcePath: string;
  errorVerbosity?: NormalizedAgentErrorVerbosity;
  retryPolicies?: AgentInvocationRetryPolicyOverrides;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  warnings: string[];
}

interface LoadAgentSessionRunnerConfigOptions {
  configPath?: string;
}

export const loadAgentSessionRunnerConfig = async (
  options: LoadAgentSessionRunnerConfigOptions = {},
): Promise<AgentSessionRunnerConfig> => {
  const sourcePath = options.configPath ?? resolveAgentInvocationConfigPath();
  const warnings: string[] = [];

  let rawText: string | null = null;
  try {
    rawText = await fs.readFile(sourcePath, 'utf8');
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined;
    if (code !== 'ENOENT') {
      warnings.push(
        `Failed to read agent invocation config at ${sourcePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (!rawText) {
    return {
      sourcePath,
      warnings,
    };
  }

  try {
    const parsed = parseRunnerConfig(JSON.parse(rawText));
    return {
      sourcePath,
      warnings,
      ...(parsed.errorVerbosity ? { errorVerbosity: parsed.errorVerbosity } : {}),
      ...(parsed.retryPolicies ? { retryPolicies: parsed.retryPolicies } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : {}),
    };
  } catch (error) {
    warnings.push(
      `Failed to parse agent invocation config at ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      sourcePath,
      warnings,
    };
  }
};
