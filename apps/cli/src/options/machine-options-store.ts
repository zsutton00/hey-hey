import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveBaseDir } from '../session/paths';

const OPTIONS_VERSION = 1;
const OPTIONS_FILENAME = 'options.json';

const persistedMachineOptionsSchema = z
  .object({
    version: z.literal(OPTIONS_VERSION),
    intentFirst: z.boolean(),
    // Files written before this option existed lack the field; they read as enabled.
    remoteToolCallViewing: z.boolean().default(true),
    jevEnabled: z.boolean().optional(),
    // The name this option was saved under while it only gated the parent feature filter.
    jevParentFeatureFilter: z.boolean().optional(),
  })
  .strict();

export interface MachineOptions {
  intentFirst: boolean;
  remoteToolCallViewing: boolean;
  jevEnabled: boolean;
}

const DEFAULT_MACHINE_OPTIONS: MachineOptions = {
  intentFirst: false,
  remoteToolCallViewing: true,
  jevEnabled: true,
};

/** Owns the durable, per-machine options file; later options become fields of the same file. */
export class MachineOptionsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: { filePath?: string } = {}) {
    this.filePath = options.filePath ?? path.join(resolveBaseDir(), OPTIONS_FILENAME);
  }

  /** A missing file reads as the defaults; an invalid file throws. */
  public async read(): Promise<MachineOptions> {
    let contents: string;
    try {
      contents = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return DEFAULT_MACHINE_OPTIONS;
      }
      throw error;
    }
    const parsed = persistedMachineOptionsSchema.parse(JSON.parse(contents));
    return {
      intentFirst: parsed.intentFirst,
      remoteToolCallViewing: parsed.remoteToolCallViewing,
      jevEnabled: parsed.jevEnabled ?? parsed.jevParentFeatureFilter ?? true,
    };
  }

  /** Applies a partial change to the saved options inside the write queue, so changing one option never overwrites another. */
  public async update(patch: Partial<MachineOptions>): Promise<MachineOptions> {
    const operation = this.writeQueue.then(async () => {
      const next = { ...(await this.read()), ...patch };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(
        temporaryPath,
        JSON.stringify({ version: OPTIONS_VERSION, ...next }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.filePath);
      return next;
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** The single reader the remote tool-call read calls on every request. */
  public async isRemoteToolCallViewingEnabled(): Promise<boolean> {
    return (await this.read()).remoteToolCallViewing;
  }

  /** Read on every Project Assistant prepare so a change applies to the next Turn. */
  public async isJevEnabled(): Promise<boolean> {
    return (await this.read()).jevEnabled;
  }
}
