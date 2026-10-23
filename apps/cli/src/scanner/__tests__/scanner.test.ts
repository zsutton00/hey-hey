import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileScanner, scannerInternals } from '../scanner';

const tempDir = path.join(process.cwd(), 'tmp-scanner-test');

const writeFile = async (targetPath: string, text = ''): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text, 'utf8');
};

describe('file scanner', () => {
  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects language markers and top-level structure', async () => {
    await writeFile(path.join(tempDir, 'package.json'), '{"name":"root"}');
    await writeFile(path.join(tempDir, 'src', 'main.ts'), 'export {};');

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 3 });
    const index = await scanner.refreshIndex();

    expect(index.repositoryRoots.some((root) => root.path === tempDir)).toBe(true);
    expect(index.repositoryRoots[0]?.markers).toContain('package.json');
    expect(index.topLevelDirectories).toContain('src');
    expect(index.candidateEntrypoints).toContain('src/main.ts');
  });

  it('handles nested repositories independently', async () => {
    const nested = path.join(tempDir, 'services', 'api');
    await writeFile(path.join(tempDir, 'package.json'), '{"name":"workspace"}');
    await writeFile(path.join(nested, 'pyproject.toml'), '[project]\nname="api"\n');
    await writeFile(path.join(nested, '__main__.py'), 'print("ok")\n');

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 5 });
    const index = await scanner.refreshIndex();

    const nestedRoot = index.repositoryRoots.find((root) => root.path === nested);
    expect(nestedRoot).toBeDefined();
    expect(nestedRoot?.markers).toContain('pyproject.toml');

    const pyEntry = index.files.find((file) => file.relativePath === 'services/api/__main__.py');
    expect(pyEntry?.language).toBe('python');
  });

  it('canonicalizes symlinked directories and avoids duplicate indexing', async () => {
    const realRepo = path.join(tempDir, 'real-repo');
    const symlinkRepo = path.join(tempDir, 'repo-link');
    await writeFile(path.join(realRepo, 'go.mod'), 'module example.com/app\n');
    await writeFile(path.join(realRepo, 'main.go'), 'package main\nfunc main() {}\n');
    await fs.symlink(realRepo, symlinkRepo);

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 3 });
    const index = await scanner.refreshIndex();

    const goFiles = index.files.filter((file) => file.relativePath.endsWith('main.go'));
    expect(goFiles).toHaveLength(1);
  });

  it('applies .gitignore patterns while traversing', async () => {
    await writeFile(path.join(tempDir, '.gitignore'), 'ignored/\n*.log\n');
    await writeFile(path.join(tempDir, 'ignored', 'skip.ts'), 'export const ignored = true;\n');
    await writeFile(path.join(tempDir, 'keep.ts'), 'export const keep = true;\n');
    await writeFile(path.join(tempDir, 'debug.log'), 'ignore me');

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 3 });
    const index = await scanner.refreshIndex();

    expect(index.files.some((file) => file.relativePath === 'ignored/skip.ts')).toBe(false);
    expect(index.files.some((file) => file.relativePath === 'debug.log')).toBe(false);
    expect(index.files.some((file) => file.relativePath === 'keep.ts')).toBe(true);
  });

  it('refreshes index cache key when files change', async () => {
    const filePath = path.join(tempDir, 'src', 'main.ts');
    await writeFile(filePath, 'export const value = 1;\n');

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 3 });
    const firstIndex = await scanner.refreshIndex();

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await writeFile(filePath, 'export const value = 2;\n');
    const secondIndex = await scanner.refreshIndex();

    expect(secondIndex.cacheKey).not.toBe(firstIndex.cacheKey);
    const firstFile = firstIndex.files.find((file) => file.relativePath === 'src/main.ts');
    const secondFile = secondIndex.files.find((file) => file.relativePath === 'src/main.ts');
    expect(secondFile?.cacheKey).not.toBe(firstFile?.cacheKey);
  });

  it('supports query filtering by language, classification, and glob', async () => {
    await writeFile(path.join(tempDir, 'src', 'main.ts'), 'export const x = 1;\n');
    await writeFile(path.join(tempDir, 'src', 'main.test.ts'), 'describe("x", () => {});\n');
    await writeFile(path.join(tempDir, 'README.md'), '# docs\n');

    const scanner = new FileScanner({ rootPath: tempDir, maxDepth: 3 });
    await scanner.refreshIndex();

    const sourceTs = scanner.queryFiles({
      languages: ['typescript'],
      classifications: ['source'],
      globPatterns: ['src/**/*.ts'],
    });

    expect(sourceTs.files.map((file) => file.relativePath)).toEqual(['src/main.ts']);
  });

  it('classifies files with simple heuristics', () => {
    expect(scannerInternals.classifyFile('src/app.ts')).toBe('source');
    expect(scannerInternals.classifyFile('src/app.test.ts')).toBe('test');
    expect(scannerInternals.classifyFile('docs/README.md')).toBe('docs');
    expect(scannerInternals.classifyFile('tsconfig.json')).toBe('config');
    expect(scannerInternals.classifyFile('dist/bundle.js')).toBe('build');
  });
});
