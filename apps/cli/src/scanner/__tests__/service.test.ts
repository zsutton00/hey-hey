import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScannerService } from '../service';

const tempDir = path.join(process.cwd(), 'tmp-scanner-service-test');

const writeFile = async (targetPath: string, text = ''): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text, 'utf8');
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('scanner service', () => {
  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reuses cached index when no changes are detected', async () => {
    await writeFile(path.join(tempDir, 'src', 'main.ts'), 'export const value = 1;\n');
    const service = new ScannerService({ watch: false, maxDepth: 4 });

    try {
      const first = await service.ensureIndexed(tempDir);
      const second = await service.ensureIndexed(tempDir);

      expect(second.cacheKey).toBe(first.cacheKey);
      expect(service.listTrackedRoots()).toHaveLength(1);
    } finally {
      await service.dispose();
    }
  });

  it('invalidates and refreshes after filesystem changes', async () => {
    await writeFile(path.join(tempDir, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
    const service = new ScannerService({ watch: false, maxDepth: 4 });

    try {
      const first = await service.ensureIndexed(tempDir);
      await sleep(40);
      await writeFile(path.join(tempDir, 'src', 'beta.ts'), 'export const beta = 2;\n');
      await service.markDirty(tempDir);

      let refreshed = first;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await sleep(60);
        refreshed = await service.ensureIndexed(tempDir);
        if (refreshed.files.some((file) => file.relativePath === 'src/beta.ts')) {
          break;
        }
      }

      expect(refreshed.cacheKey).not.toBe(first.cacheKey);
      expect(refreshed.files.some((file) => file.relativePath === 'src/beta.ts')).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it('queries files through the shared service API', async () => {
    await writeFile(path.join(tempDir, 'src', 'main.ts'), 'export const main = true;\n');
    await writeFile(path.join(tempDir, 'src', 'main.test.ts'), 'describe("main", () => {});\n');

    const service = new ScannerService({ watch: false, maxDepth: 4 });

    try {
      const query = await service.queryFiles(tempDir, {
        classifications: ['source'],
        languages: ['typescript'],
        globPatterns: ['src/**/*.ts'],
      });

      expect(query.files.map((file) => file.relativePath)).toEqual(['src/main.ts']);
    } finally {
      await service.dispose();
    }
  });
});
