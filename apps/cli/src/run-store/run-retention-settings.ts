import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveBaseDir } from '../session/paths';

export const DEFAULT_RUN_RETENTION_DAYS = 30;

export type RunRetentionSetting =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly days: number };

const parseSetting = (value: unknown): RunRetentionSetting => {
  if (value === undefined) return { enabled: true, days: DEFAULT_RUN_RETENTION_DAYS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored Run retention setting is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (record['enabled'] === false) return { enabled: false };
  const days = record['days'];
  if (record['enabled'] === true && Number.isInteger(days) && Number(days) > 0) {
    return { enabled: true, days: Number(days) };
  }
  throw new Error('Stored Run retention setting is invalid.');
};

export class RunRetentionSettingsStore {
  private readonly preferencesPath: string;

  public constructor(baseDir: string = resolveBaseDir()) {
    this.preferencesPath = path.join(baseDir, 'preferences.json');
  }

  public async load(): Promise<RunRetentionSetting> {
    try {
      const preferences = JSON.parse(
        await fs.readFile(this.preferencesPath, 'utf8'),
      ) as Record<string, unknown>;
      return parseSetting(preferences['runRetention']);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { enabled: true, days: DEFAULT_RUN_RETENTION_DAYS };
      }
      throw error;
    }
  }

  public async set(setting: RunRetentionSetting): Promise<void> {
    const normalized = parseSetting(setting);
    let preferences: Record<string, unknown> = {};
    try {
      preferences = JSON.parse(
        await fs.readFile(this.preferencesPath, 'utf8'),
      ) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    preferences['runRetention'] = normalized;
    await fs.mkdir(path.dirname(this.preferencesPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.preferencesPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(preferences, null, 2), 'utf8');
    await fs.rename(temporaryPath, this.preferencesPath);
  }
}
