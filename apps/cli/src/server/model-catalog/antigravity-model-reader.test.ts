/** @vitest-environment node */

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityNotReadyError } from '../../agents/providers/antigravity/antigravity-readiness';
import { selectRunSkills } from '../../agents/providers/antigravity/antigravity-skill-catalog';
import { AntigravityModelReader } from './antigravity-models';

const directories: string[] = [];

/** An `agy` that explains itself on stderr and exits, the way a refused sign-in does. */
const agyThatExits = async (stderr: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'heyhey-fake-agy-'));
  directories.push(directory);
  const executable = join(directory, 'agy');
  await writeFile(executable, `#!/bin/sh\necho '${stderr}' >&2\nexit 1\n`);
  await chmod(executable, 0o755);
  return executable;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('the Antigravity model catalog entry point', () => {
  it('reports a signed-out agy as not signed in, using what agy printed on stderr', async () => {
    const reader = new AntigravityModelReader(
      await agyThatExits('Error: You are not logged into Antigravity.'),
    );

    await expect(reader.readModels()).rejects.toMatchObject({
      name: 'AntigravityNotReadyError',
      cause_: 'not_signed_in',
    });
  });

  it('reports an organization policy denial as its own cause', async () => {
    const reader = new AntigravityModelReader(
      await agyThatExits('Access to Antigravity is disabled by your organization policy.'),
    );

    const error = await reader.readModels().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AntigravityNotReadyError);
    expect((error as AntigravityNotReadyError).cause_).toBe('org_policy_denied');
  });

  it('keeps sign-in URLs and their parameters out of the error the selector shows', async () => {
    const reader = new AntigravityModelReader(
      await agyThatExits(
        'Authentication required. Open https://accounts.example.com/o/oauth2/auth?client_id=abc&state=live-state-123&code_challenge=live-challenge-456 to sign in',
      ),
    );

    const error = (await reader.readModels().catch((caught: unknown) => caught)) as Error;

    expect(error).toBeInstanceOf(AntigravityNotReadyError);
    expect((error as AntigravityNotReadyError).cause_).toBe('not_signed_in');
    expect(error.message).not.toMatch(/live-state-123|live-challenge-456|oauth2|client_id/);
  });

  it('keeps the specific reason for an exit it cannot classify', async () => {
    const reader = new AntigravityModelReader(await agyThatExits('quota backend unreachable'));

    await expect(reader.readModels()).rejects.toThrow(/quota backend unreachable/);
  });
});

describe('the skills a run is offered', () => {
  const catalog = {
    provider: 'antigravity' as const,
    errors: [],
    skills: [
      { provider: 'antigravity' as const, name: 'swarm', catalogScope: 'system' as const },
      { provider: 'antigravity' as const, name: 'my-skill', catalogScope: 'user' as const },
      { provider: 'antigravity' as const, name: 'disabled', catalogScope: 'user' as const },
    ].map((skill) => ({ ...skill, description: skill.name, enabled: true })),
  };

  it('offers only what the live session advertised', () => {
    const names = selectRunSkills(catalog, new Set(['swarm', 'my-skill', 'compact'])).skills.map(
      (skill) => skill.name,
    );

    expect(names).toEqual(['swarm', 'my-skill']);
  });

  it('offers only agy-shipped skills before a session has reported anything', () => {
    const names = selectRunSkills(catalog, undefined).skills.map((skill) => skill.name);

    expect(names).toEqual(['swarm']);
  });
});
