import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveReference, suggestReferences } from '../index';

let baseDir: string;
let tempDir: string;

const writeFile = async (targetPath: string, text = ''): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text, 'utf8');
};

describe('file reference resolver', () => {
  beforeEach(async () => {
    baseDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'file-references-')));
    tempDir = path.join(baseDir, 'repo');
    await fs.mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'src', 'main.ts'), 'export const x = 1;\n');
    await writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {};\n');
    await writeFile(path.join(tempDir, 'test', 'index.ts'), 'describe("x", () => {});\n');
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('resolves in-repo paths with normalized output', async () => {
    const result = await resolveReference('@src/main.ts:1-2', {
      repositoryPath: tempDir,
      indexedFiles: ['src/main.ts'],
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }

    expect(result.value.relativePath).toBe('src/main.ts');
    expect(result.value.lineRange).toEqual({ startLine: 1, endLine: 2 });
  });

  it('returns candidate matches when reference is ambiguous', async () => {
    const result = await resolveReference('@index.ts', {
      repositoryPath: tempDir,
      indexedFiles: ['src/index.ts', 'test/index.ts'],
    });

    expect(result.status).toBe('candidates');
    if (result.status !== 'candidates') {
      return;
    }

    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks cross-repo paths by default', async () => {
    const outside = path.join(path.dirname(tempDir), 'outside.ts');
    await writeFile(outside, 'export const y = 1;\n');

    const result = await resolveReference(`@${outside}`, {
      repositoryPath: tempDir,
      indexedFiles: ['src/main.ts'],
    });

    expect(result.status).toBe('error');
    if (result.status !== 'error') {
      return;
    }

    expect(result.code).toBe('CROSS_REPO_BLOCKED');
  });

  it('returns readable suggestions for partial input', async () => {
    const result = await suggestReferences('@src/ma', {
      repositoryPath: tempDir,
      indexedFiles: ['src/main.ts', 'src/index.ts'],
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.hasSelectableSuggestions).toBe(true);
  });
});
