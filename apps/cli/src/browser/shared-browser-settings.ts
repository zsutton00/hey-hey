import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveBaseDir } from '../session/paths';

const SETTINGS_VERSION = 1;
const SETTINGS_FILENAME = 'shared-browser-settings.json';

const persistedSharedBrowserSettingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    enabled: z.boolean(),
  })
  .strict();

export interface SharedBrowserSettings {
  enabled: boolean;
}

const DEFAULT_SHARED_BROWSER_SETTINGS: SharedBrowserSettings = { enabled: true };

/** Owns the durable, per-machine Shared Browser on/off setting. */
export class SharedBrowserSettingsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: { filePath?: string } = {}) {
    this.filePath = options.filePath ?? path.join(resolveBaseDir(), SETTINGS_FILENAME);
  }

  public async read(): Promise<SharedBrowserSettings> {
    let contents: string;
    try {
      contents = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return DEFAULT_SHARED_BROWSER_SETTINGS;
      }
      throw error;
    }
    const parsed = persistedSharedBrowserSettingsSchema.parse(JSON.parse(contents));
    return { enabled: parsed.enabled };
  }

  public async write(settings: SharedBrowserSettings): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(
        temporaryPath,
        JSON.stringify({ version: SETTINGS_VERSION, enabled: settings.enabled }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.filePath);
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
