import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CodingAgentDetector } from './coding-agent-detection';

const directories: string[] = [];

const binDirectory = async (executables: string[]): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-'));
  directories.push(directory);
  for (const name of executables) {
    const file = join(directory, name);
    await writeFile(file, '#!/bin/sh\n');
    await chmod(file, 0o755);
  }

  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('CodingAgentDetector', () => {
  it('reports each coding agent independently from the executables on PATH', async () => {
    const bin = await binDirectory(['claude', 'opencode']);

    const detected = await new CodingAgentDetector(bin).detect();

    expect(detected).toEqual({ claude: 'installed', codex: 'not-found', opencode: 'installed' });
  });

  it('reports none found for an empty PATH and never exposes paths', async () => {
    const detected = await new CodingAgentDetector('').detect();

    expect(detected).toEqual({ claude: 'not-found', codex: 'not-found', opencode: 'not-found' });
    expect(JSON.stringify(detected)).not.toContain('/');
  });

  it('does not count a non-executable file as installed', async () => {
    const bin = await binDirectory([]);
    await writeFile(join(bin, 'codex'), 'not executable');

    const detected = await new CodingAgentDetector(bin).detect();

    expect(detected.codex).not.toBe('installed');
  });

  it('finds Windows installs through PATHEXT, since a bare name is not a file there', async () => {
    const bin = await binDirectory(['claude.cmd', 'codex.exe']);

    const detected = await new CodingAgentDetector(bin, 'win32', '.EXE;.CMD').detect();

    expect(detected).toEqual({ claude: 'installed', codex: 'installed', opencode: 'not-found' });
  });

  it('does not treat an extensionless file as a Windows install', async () => {
    const bin = await binDirectory(['claude']);

    const detected = await new CodingAgentDetector(bin, 'win32', '.EXE;.CMD').detect();

    expect(detected.claude).toBe('not-found');
  });
});
