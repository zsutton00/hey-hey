import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadHelpContentSource,
  DEFAULT_HELP_CONTENT_DIRECTORY,
} from '../help-content-source';

const API_ROOT = path.resolve(__dirname, '../../..');
const REPOSITORY_ROOT = path.resolve(API_ROOT, '../..');
const ASSET_NAME = 'agent-bridge-overview.svg';

describe('packaged Help content', () => {
  it('keeps repository assets in the production content package', async () => {
    const dockerfile = await fs.readFile(
      path.join(API_ROOT, 'Dockerfile'),
      'utf8',
    );
    const dockerignore = await fs.readFile(
      path.join(REPOSITORY_ROOT, '.dockerignore'),
      'utf8',
    );
    const packageDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'help-content-package-'),
    );

    try {
      expect(dockerfile).toContain('COPY apps/api/content ./content');
      expect(dockerignore).not.toMatch(/^(?:apps\/api\/|\*\*\/)?content(?:\/|$)/m);

      await fs.cp(
        path.join(API_ROOT, 'content'),
        path.join(packageDirectory, 'content'),
        { recursive: true },
      );

      const packagedHelpDirectory = path.join(packageDirectory, 'content/help');
      const packagedAssetPath = path.join(
        packagedHelpDirectory,
        'assets',
        ASSET_NAME,
      );
      const nodes = await loadHelpContentSource(packagedHelpDirectory);

      expect(
        nodes.find((node) => node.slug === 'install-agent-bridge')?.body,
      ).toContain(`assets/${ASSET_NAME}`);
      const packagedAsset = await fs.stat(packagedAssetPath);
      expect(packagedAsset.isFile()).toBe(true);
    } finally {
      await fs.rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it('uses the repository Help content directory as the default source', () => {
    expect(DEFAULT_HELP_CONTENT_DIRECTORY).toBe(
      path.join(API_ROOT, 'content/help'),
    );
  });
});
