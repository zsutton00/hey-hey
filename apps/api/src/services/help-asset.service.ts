import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_HELP_ASSET_DIRECTORY,
  getHelpAssetMediaType,
  normalizeHelpAssetReference,
} from './help-content-source';

export interface HelpAsset {
  body: Buffer;
  mediaType: string;
}

export class HelpAssetPathError extends Error {}

export class HelpAssetNotFoundError extends Error {}

@Injectable()
export class HelpAssetService {
  constructor(@Optional() assetDirectory?: string) {
    this.assetDirectory = assetDirectory ?? DEFAULT_HELP_ASSET_DIRECTORY;
  }

  private readonly assetDirectory: string;

  async readAsset(assetPath: string): Promise<HelpAsset> {
    const reference = `assets/${assetPath}`;
    let normalizedReference: string;
    try {
      normalizedReference = normalizeHelpAssetReference(reference);
    } catch (error) {
      throw new HelpAssetPathError(errorMessage(error));
    }

    const relativeAssetPath = normalizedReference.slice('assets/'.length);
    let realAssetDirectory: string;
    try {
      realAssetDirectory = await fs.realpath(this.assetDirectory);
    } catch {
      throw new HelpAssetNotFoundError(`Help asset not found: ${assetPath}`);
    }

    const candidate = path.resolve(realAssetDirectory, relativeAssetPath);
    assertContainedPath(realAssetDirectory, candidate, assetPath);

    let realPath: string;
    try {
      realPath = await fs.realpath(candidate);
    } catch {
      throw new HelpAssetNotFoundError(`Help asset not found: ${assetPath}`);
    }
    assertContainedPath(realAssetDirectory, realPath, assetPath);

    let stats;
    try {
      stats = await fs.stat(realPath);
    } catch {
      throw new HelpAssetNotFoundError(`Help asset not found: ${assetPath}`);
    }

    const mediaType = getHelpAssetMediaType(realPath);
    if (!stats.isFile() || mediaType === null) {
      throw new HelpAssetNotFoundError(`Help asset not found: ${assetPath}`);
    }

    return {
      body: await fs.readFile(realPath),
      mediaType,
    };
  }
}

function assertContainedPath(
  root: string,
  candidate: string,
  assetPath: string,
): void {
  const relative = path.relative(root, candidate);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new HelpAssetPathError(
      `Help asset path escapes assets/: ${assetPath}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
