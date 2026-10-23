import path from 'node:path';
import { z } from 'zod';

import type { AgentProviderId } from '../agents/providers/provider-config';

export interface ProjectModeLaunchResumeProbeArgs {
  readonly apiBaseUrl: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly modeId: string;
  readonly serviceId: string;
  readonly repositoryPath: string;
  readonly provider: AgentProviderId;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

const VALUE_FLAGS = new Set([
  '--api-base-url',
  '--organization-id',
  '--project-id',
  '--task-id',
  '--mode-id',
  '--service-id',
  '--repository-path',
  '--provider',
  '--model',
  '--reasoning-effort',
  '--timeout-ms',
  '--max-output-bytes',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PROVIDERS = new Set<AgentProviderId>(['claude', 'codex', 'opencode']);
const EFFORTS = new Set<ProjectModeLaunchResumeProbeArgs['reasoningEffort']>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const readFlags = (argv: readonly string[]): ReadonlyMap<string, string> => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag || !VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown project MODE probe argument: ${flag ?? '<missing>'}.`);
    }
    if (values.has(flag)) throw new Error(`Duplicate project MODE probe argument: ${flag}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Project MODE probe argument ${flag} requires a value.`);
    }
    values.set(flag, value);
    index += 1;
  }
  return values;
};

const required = (values: ReadonlyMap<string, string>, flag: string): string => {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`Project MODE probe requires ${flag}.`);
  return value;
};

const parseLoopbackUrl = (value: string, label: string, protocols: readonly string[]): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${label} uses an unsupported protocol.`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must target a loopback host; refusing a production-like target.`);
  }
  return parsed;
};

const requireUuid = (values: ReadonlyMap<string, string>, flag: string): string => {
  const value = required(values, flag);
  if (!z.string().uuid().safeParse(value).success) throw new Error(`${flag} must be a UUID.`);
  return value;
};

const boundedInteger = (
  values: ReadonlyMap<string, string>,
  flag: string,
  minimum: number,
  maximum: number,
): number => {
  const value = required(values, flag);
  if (!/^\d+$/u.test(value)) throw new Error(`${flag} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be between ${String(minimum)} and ${String(maximum)}.`);
  }
  return parsed;
};

export const parseProjectModeLaunchResumeProbeArgs = (
  argv: readonly string[],
): ProjectModeLaunchResumeProbeArgs => {
  const values = readFlags(argv[0] === '--' ? argv.slice(1) : argv);
  const apiBaseUrl = parseLoopbackUrl(required(values, '--api-base-url'), '--api-base-url', [
    'http:',
    'https:',
  ]);
  const provider = required(values, '--provider');
  if (!PROVIDERS.has(provider as AgentProviderId)) {
    throw new Error('--provider must be one of claude, codex, or opencode.');
  }
  const reasoningEffort = required(values, '--reasoning-effort');
  if (!EFFORTS.has(reasoningEffort as ProjectModeLaunchResumeProbeArgs['reasoningEffort'])) {
    throw new Error('--reasoning-effort must be one of low, medium, high, xhigh, or max.');
  }

  const repositoryPath = required(values, '--repository-path');
  if (!path.isAbsolute(repositoryPath)) {
    throw new Error('--repository-path must be an absolute path.');
  }

  return Object.freeze({
    apiBaseUrl: apiBaseUrl.toString().replace(/\/$/u, ''),
    organizationId: requireUuid(values, '--organization-id'),
    projectId: requireUuid(values, '--project-id'),
    taskId: requireUuid(values, '--task-id'),
    modeId: requireUuid(values, '--mode-id'),
    serviceId: requireUuid(values, '--service-id'),
    repositoryPath: path.resolve(repositoryPath),
    provider: provider as AgentProviderId,
    model: required(values, '--model'),
    reasoningEffort: reasoningEffort as ProjectModeLaunchResumeProbeArgs['reasoningEffort'],
    timeoutMs: boundedInteger(values, '--timeout-ms', 1_000, 300_000),
    maxOutputBytes: boundedInteger(values, '--max-output-bytes', 256, 65_536),
  });
};
