import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HelpAssetNotFoundError,
  HelpAssetPathError,
  HelpAssetService,
} from '../help-asset.service';

describe('HelpAssetService', () => {
  let rootDirectory: string;
  let assetsDirectory: string;
  let outsideDirectory: string;
  let service: HelpAssetService;

  beforeEach(async () => {
    rootDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'heyhey-help-assets-'),
    );
    assetsDirectory = path.join(rootDirectory, 'assets');
    outsideDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'heyhey-help-assets-outside-'),
    );
    await fs.mkdir(assetsDirectory);
    await fs.writeFile(path.join(assetsDirectory, 'diagram.png'), 'png bytes');
    service = new HelpAssetService(assetsDirectory);
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(rootDirectory, { recursive: true, force: true }),
      fs.rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  });

  it('reads a packaged image with its media type', async () => {
    await expect(service.readAsset('diagram.png')).resolves.toEqual({
      body: Buffer.from('png bytes'),
      mediaType: 'image/png',
    });
  });

  it('rejects missing images as not found', async () => {
    await expect(service.readAsset('missing.png')).rejects.toBeInstanceOf(
      HelpAssetNotFoundError,
    );
  });

  it.each(['../outside.png', '..%2foutside.png', '%2e%2e/outside.png'])(
    'rejects traversal path %s',
    async (assetPath) => {
      await expect(service.readAsset(assetPath)).rejects.toBeInstanceOf(
        HelpAssetPathError,
      );
    },
  );

  it('rejects a symlink that resolves outside the assets directory', async () => {
    const outsideAsset = path.join(outsideDirectory, 'secret.png');
    const linkedAsset = path.join(assetsDirectory, 'linked.png');
    await fs.writeFile(outsideAsset, 'secret');
    await fs.symlink(outsideAsset, linkedAsset);

    await expect(service.readAsset('linked.png')).rejects.toBeInstanceOf(
      HelpAssetPathError,
    );
  });
});
