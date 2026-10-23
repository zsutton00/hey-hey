import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadAgentSessionRunnerConfig,
  resolveAgentInvocationConfigPath,
} from './session-runner-config';

describe('session-runner-config', () => {
  const originalConfigPath = process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH'];
  const originalConfigDir = process.env['HEYHEY_CONFIG_DIR'];

  afterEach(() => {
    process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH'] = originalConfigPath;
    process.env['HEYHEY_CONFIG_DIR'] = originalConfigDir;
  });

  it('returns defaults when config file is missing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-runner-config-'));
    const configPath = path.join(tempDir, 'missing.json');

    const loaded = await loadAgentSessionRunnerConfig({ configPath });

    expect(loaded.sourcePath).toBe(configPath);
    expect(loaded.retryPolicies).toBeUndefined();
    expect(loaded.errorVerbosity).toBeUndefined();
    expect(loaded.warnings).toEqual([]);
  });

  it('loads nested invocation config and keeps valid retry fields', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-runner-config-'));
    const configPath = path.join(tempDir, 'agent-invocation.json');
    await writeFile(
      configPath,
      JSON.stringify({
        agentInvocation: {
          errorVerbosity: 'compact',
          retryPolicies: {
            claude: {
              maxAttempts: 4,
              initialDelayMs: 500,
              multiplier: 2,
            },
            codex: {
              maxAttempts: 'oops',
              jitterRatio: 0.15,
            },
          },
        },
      }),
      'utf8',
    );

    const loaded = await loadAgentSessionRunnerConfig({ configPath });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.errorVerbosity).toBe('compact');
    expect(loaded.retryPolicies).toEqual({
      claude: {
        maxAttempts: 4,
        initialDelayMs: 500,
        multiplier: 2,
      },
      codex: {
        jitterRatio: 0.15,
      },
    });
  });

  it('returns warnings for invalid JSON', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-runner-config-'));
    const configPath = path.join(tempDir, 'agent-invocation.json');
    await writeFile(configPath, '{not json', 'utf8');

    const loaded = await loadAgentSessionRunnerConfig({ configPath });

    expect(loaded.retryPolicies).toBeUndefined();
    expect(loaded.errorVerbosity).toBeUndefined();
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain('Failed to parse agent invocation config');
  });

  it('loads model and reasoningEffort from config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-runner-config-'));
    const configPath = path.join(tempDir, 'agent-invocation.json');
    await writeFile(
      configPath,
      JSON.stringify({
        agentInvocation: {
          model: 'claude-sonnet-4-6',
          reasoningEffort: 'high',
        },
      }),
      'utf8',
    );

    const loaded = await loadAgentSessionRunnerConfig({ configPath });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.model).toBe('claude-sonnet-4-6');
    expect(loaded.reasoningEffort).toBe('high');
  });

  it('ignores invalid reasoningEffort values', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-runner-config-'));
    const configPath = path.join(tempDir, 'agent-invocation.json');
    await writeFile(
      configPath,
      JSON.stringify({
        agentInvocation: {
          model: '  ',
          reasoningEffort: 'max',
        },
      }),
      'utf8',
    );

    const loaded = await loadAgentSessionRunnerConfig({ configPath });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.model).toBeUndefined();
    expect(loaded.reasoningEffort).toBeUndefined();
  });

  it('resolves path from environment overrides', () => {
    process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH'] = '/tmp/custom-agent-invocation.json';
    expect(resolveAgentInvocationConfigPath()).toBe('/tmp/custom-agent-invocation.json');

    delete process.env['HEYHEY_AGENT_INVOCATION_CONFIG_PATH'];
    process.env['HEYHEY_CONFIG_DIR'] = '/tmp/heyhey-config-dir';
    expect(resolveAgentInvocationConfigPath()).toBe(
      path.join('/tmp/heyhey-config-dir', 'agent-invocation.json'),
    );
  });
});
