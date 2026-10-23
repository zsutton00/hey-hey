import { existsSync, chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexSkillCatalog,
  CodexSkillCatalogReader,
  type CodexSkillsListResponse,
} from './codex-skill-catalog';

describe('CodexSkillCatalogReader', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent reads and releases failed reads for retry', async () => {
    const reader = new CodexSkillCatalogReader(50);
    const missing = '/a-workspace-that-does-not-exist/heyhey';
    const first = reader.listSkills(missing);
    expect(reader.listSkills(missing)).toBe(first);
    await expect(first).rejects.toThrow();
    const retry = reader.listSkills(missing);
    expect(retry).not.toBe(first);
    await expect(retry).rejects.toThrow();
  });

  it('requests a force-refreshed Skill catalog for the requested workspace', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hey-hey-codex-skills-'));
    temporaryDirectories.push(directory);
    const scriptPath = join(directory, 'mock-codex.mjs');
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node
process.stdin.setEncoding('utf8');
let buffer = '';
let initialized = false;
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\\n')) {
    const newlineIndex = buffer.indexOf('\\n');
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialized') {
      initialized = true;
      continue;
    }
    if (request.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
    }
    if (request.method === 'skills/list') {
      const cwd = request.params.cwds[0];
      if (!initialized || request.params.forceReload !== true || request.params.cwds.length !== 1) {
        process.stdout.write(JSON.stringify({
          id: request.id,
          error: { message: 'unexpected skills/list request' }
        }) + '\\n');
        continue;
      }
      process.stdout.write(JSON.stringify({
        id: request.id,
        result: {
          data: [{
            cwd,
            skills: [{
              name: 'custom-skill',
              description: 'A user-created Codex Skill',
              path: cwd + '/.codex/skills/custom-skill/SKILL.md',
              scope: 'repo',
              enabled: true
            }],
            errors: [{
              path: cwd + '/.codex/skills/broken-skill/SKILL.md',
              message: 'Unable to read SKILL.md'
            }]
          }]
        }
      }) + '\\n');
    }
  }
});

`,
      'utf8',
    );
    chmodSync(scriptPath, 0o755);

    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${directory}:${originalPath ?? ''}`;
    const codexShim = join(directory, 'codex');
    writeFileSync(
      codexShim,
      `#!/bin/sh
exec node ${JSON.stringify(scriptPath)}
`,
      'utf8',
    );
    chmodSync(codexShim, 0o755);

    try {
      const result = await new CodexSkillCatalogReader().listSkills(directory);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        cwd: directory,
        skills: [
          {
            name: 'custom-skill',
            scope: 'repo',
            enabled: true,
          },
        ],
        errors: [
          {
            path: `${directory}/.codex/skills/broken-skill/SKILL.md`,
            message: 'Unable to read SKILL.md',
          },
        ],
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env['PATH'];
      } else {
        process.env['PATH'] = originalPath;
      }
    }
  });
});

const catalogResponse = (
  overrides: Partial<CodexSkillsListResponse> = {},
): CodexSkillsListResponse => ({
  data: [
    {
      cwd: '/workspace',
      skills: [
        {
          name: 'my-skill',
          description: 'My local workflow',
          shortDescription: 'Local workflow',
          path: '/workspace/.codex/skills/my-skill/SKILL.md',
          scope: 'repo',
          enabled: true,
          interface: { displayName: 'My Skill' },
          dependencies: {
            tools: [{ type: 'mcp', value: 'heyhey', description: 'Hey Hey tools' }],
          },
        },
      ],
      errors: [
        {
          path: '/workspace/.codex/skills/broken/SKILL.md',
          message: 'Unable to read SKILL.md',
        },
      ],
    },
  ],
  ...overrides,
});

describe('CodexSkillCatalog', () => {
  it('returns provider metadata and discovery errors without local paths', async () => {
    const reader = new CodexSkillCatalogReader();
    vi.spyOn(reader, 'listSkills').mockResolvedValue(catalogResponse());

    const catalog = await new CodexSkillCatalog(reader).list({
      policy: 'service_workspace',
      cwd: '/workspace',
      authorityId: 'test',
    });

    expect(catalog).toEqual({
      provider: 'codex',
      skills: [
        {
          provider: 'codex',
          name: 'my-skill',
          catalogScope: 'repo',
          description: 'My local workflow',
          shortDescription: 'Local workflow',
          enabled: true,
          interface: { displayName: 'My Skill' },
          dependencies: {
            tools: [{ type: 'mcp', value: 'heyhey', description: 'Hey Hey tools' }],
          },
        },
      ],
      errors: [{ provider: 'codex', message: 'Unable to read SKILL.md' }],
    });
    expect(JSON.stringify(catalog)).not.toContain('/workspace');
  });

  it('freshly resolves a pathless selection to Codex native Skill input', async () => {
    const reader = new CodexSkillCatalogReader();
    const listSkills = vi.spyOn(reader, 'listSkills').mockResolvedValue(catalogResponse());

    const resolved = await new CodexSkillCatalog(reader).resolve(
      { policy: 'service_workspace', cwd: '/workspace', authorityId: 'test' },
      {
        provider: 'codex',
        name: 'my-skill',
        catalogScope: 'repo',
      },
    );

    expect(listSkills).toHaveBeenCalledOnce();
    expect(listSkills).toHaveBeenCalledWith('/workspace');
    expect(resolved).toEqual({
      type: 'skill',
      name: 'my-skill',
      path: '/workspace/.codex/skills/my-skill/SKILL.md',
    });
  });

  it('rejects unavailable and ambiguous selections explicitly', async () => {
    const unavailableReader = new CodexSkillCatalogReader();
    vi.spyOn(unavailableReader, 'listSkills').mockResolvedValue(catalogResponse({ data: [] }));
    await expect(
      new CodexSkillCatalog(unavailableReader).resolve(
        { policy: 'service_workspace', cwd: '/workspace', authorityId: 'test' },
        {
          provider: 'codex',
          name: 'missing',
          catalogScope: 'repo',
        },
      ),
    ).rejects.toMatchObject({ code: 'SKILL_UNAVAILABLE' });

    const duplicate = catalogResponse().data[0]!.skills[0]!;
    const ambiguousReader = new CodexSkillCatalogReader();
    vi.spyOn(ambiguousReader, 'listSkills').mockResolvedValue(
      catalogResponse({
        data: [{ cwd: '/workspace', skills: [duplicate, { ...duplicate }], errors: [] }],
      }),
    );
    await expect(
      new CodexSkillCatalog(ambiguousReader).resolve(
        { policy: 'service_workspace', cwd: '/workspace', authorityId: 'test' },
        {
          provider: 'codex',
          name: 'my-skill',
          catalogScope: 'repo',
        },
      ),
    ).rejects.toMatchObject({ code: 'SKILL_AMBIGUOUS' });
  });
});

describe('non-repository catalog authority', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses an isolated boundary for listing and fresh resolution, then removes it', async () => {
    vi.stubEnv('GIT_DIR', '/a-repository-outside-the-authorized-catalog');
    const reader = new CodexSkillCatalogReader();
    const directories: string[] = [];
    const list = vi.spyOn(reader, 'listSkills').mockImplementation(async (cwd) => {
      directories.push(cwd);
      expect(cwd).not.toBe(process.cwd());
      expect(existsSync(join(cwd, '.git'))).toBe(true);
      return {
        data: [
          {
            cwd,
            skills: [
              {
                name: 'personal',
                description: 'Personal',
                path: '/home/user/skills/personal/SKILL.md',
                scope: 'user',
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      };
    });
    const catalog = new CodexSkillCatalog(reader);
    const context = { policy: 'non_repository' as const, authorityId: 'org-project-machine-user' };
    expect(await catalog.list(context)).toMatchObject({
      skills: [{ name: 'personal', catalogScope: 'user' }],
    });
    expect(existsSync(directories[0]!)).toBe(false);
    expect(
      await catalog.resolve(context, { provider: 'codex', name: 'personal', catalogScope: 'user' }),
    ).toEqual({ type: 'skill', name: 'personal', path: '/home/user/skills/personal/SKILL.md' });
    expect(list).toHaveBeenCalledTimes(2);
    expect(directories[0]).not.toBe(directories[1]);
    expect(existsSync(directories[1]!)).toBe(false);
  });
  it('rejects unsupported isolation rather than filtering an unauthorized repository catalog', async () => {
    const reader = new CodexSkillCatalogReader();
    let directory = '';
    vi.spyOn(reader, 'listSkills').mockImplementation(async (cwd) => {
      directory = cwd;
      return catalogResponse();
    });
    const catalog = new CodexSkillCatalog(reader);
    await expect(catalog.list({ policy: 'non_repository', authorityId: 'test' })).rejects.toThrow(
      'repository Skills',
    );
    expect(existsSync(directory)).toBe(false);
  });
  it('coalesces identical authority but never shares a result across authorities', async () => {
    const reader = new CodexSkillCatalogReader();
    const read = vi.spyOn(reader, 'listSkills').mockResolvedValue({ data: [] });
    const catalog = new CodexSkillCatalog(reader);
    const context = { policy: 'service_workspace' as const, cwd: '/workspace', authorityId: 'one' };
    await Promise.all([
      catalog.list(context),
      catalog.list(context),
      catalog.list({ ...context, authorityId: 'two' }),
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    await catalog.list(context);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
