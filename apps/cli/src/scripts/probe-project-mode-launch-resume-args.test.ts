import { describe, expect, it } from 'vitest';

import { parseProjectModeLaunchResumeProbeArgs } from './probe-project-mode-launch-resume-args';

const validArgs: string[] = [
  '--api-base-url',
  'http://127.0.0.1:3000',
  '--organization-id',
  '10000000-0000-4000-8000-000000000001',
  '--project-id',
  '10000000-0000-4000-8000-000000000002',
  '--task-id',
  '10000000-0000-4000-8000-000000000003',
  '--mode-id',
  '10000000-0000-4000-8000-000000000004',
  '--service-id',
  '10000000-0000-4000-8000-000000000005',
  '--repository-path',
  '/work/cli',
  '--provider',
  'codex',
  '--model',
  'gpt-5',
  '--reasoning-effort',
  'high',
  '--timeout-ms',
  '60000',
  '--max-output-bytes',
  '4096',
];

describe('parseProjectModeLaunchResumeProbeArgs', () => {
  it('parses an explicit local probe target', () => {
    expect(parseProjectModeLaunchResumeProbeArgs(validArgs)).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:3000',
      provider: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
      timeoutMs: 60000,
      maxOutputBytes: 4096,
    });
  });

  it('accepts the package-runner argument separator', () => {
    expect(parseProjectModeLaunchResumeProbeArgs(['--', ...validArgs])).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:3000',
      provider: 'codex',
    });
  });

  it.each([['remote API', '--api-base-url', 'https://heyhey.dev']])(
    'rejects a %s before execution',
    (_label, flag, replacement) => {
      const args = [...validArgs];
      args[args.indexOf(flag) + 1] = replacement;
      expect(() => parseProjectModeLaunchResumeProbeArgs(args)).toThrow(
        /loopback|production-like/u,
      );
    },
  );

  it('rejects missing, malformed, duplicate, and unknown inputs', () => {
    const missingProvider = [...validArgs];
    missingProvider.splice(missingProvider.indexOf('--provider'), 2);
    expect(() => parseProjectModeLaunchResumeProbeArgs(missingProvider)).toThrow('--provider');
    expect(() =>
      parseProjectModeLaunchResumeProbeArgs([...validArgs, '--provider', 'claude']),
    ).toThrow('Duplicate');
    expect(() =>
      parseProjectModeLaunchResumeProbeArgs([...validArgs, '--surprise', 'yes']),
    ).toThrow('Unknown');
    const malformed = [...validArgs];
    malformed[malformed.indexOf('--mode-id') + 1] = 'not-a-uuid';
    expect(() => parseProjectModeLaunchResumeProbeArgs(malformed)).toThrow(
      '--mode-id must be a UUID',
    );
  });

  it.each([
    ['--timeout-ms', '999'],
    ['--timeout-ms', '300001'],
    ['--max-output-bytes', '255'],
    ['--max-output-bytes', '65537'],
  ])('rejects an out-of-range %s', (flag, replacement) => {
    const args = [...validArgs];
    args[args.indexOf(flag) + 1] = replacement;
    expect(() => parseProjectModeLaunchResumeProbeArgs(args)).toThrow('must be between');
  });
});
