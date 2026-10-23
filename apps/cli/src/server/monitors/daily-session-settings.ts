import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveBaseDir } from '../../session/paths';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import type { ServerLogger } from '../logger';
import {
  DEFAULT_EVENT_THRESHOLD,
  DEFAULT_TRIGGER_CONFIG,
  type TriggerConfig,
} from './trigger-config';

const SETTINGS_VERSION = 2;
const SETTINGS_FILENAME = 'daily-session-settings.json';

const persistedDailySessionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.nativeEnum(LocalRunProvider).optional(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.nativeEnum(LocalReasoningEffort).optional(),
    countThreshold: z.number().int().positive(),
    eventTypes: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const persistedSettingsFileSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(SETTINGS_VERSION)]),
    projects: z.record(z.string(), z.unknown()),
  })
  .strict();

const persistedProjectSettingsRecordSchema = z
  .object({
    settings: z.unknown(),
    persistenceRevision: z.number().int().nonnegative(),
  })
  .strict();

export interface DailySessionLaunchSettings {
  provider: LocalRunProvider;
  model: string;
  reasoningEffort: LocalReasoningEffort;
}

export interface DailySessionSettings extends DailySessionLaunchSettings {
  enabled: boolean;
  countThreshold: number;
  eventTypes: readonly string[];
}

export type PersistedDailySessionSettings = Omit<
  DailySessionSettings,
  keyof DailySessionLaunchSettings
> &
  Partial<DailySessionLaunchSettings>;

export type DailySessionSettingsResolution =
  | {
      status: 'ready';
      settings: DailySessionSettings;
      usedDefaultLaunch: boolean;
      effectiveValueSource: 'persisted' | 'default';
      persistenceRevision: number;
    }
  | { status: 'invalid'; issues: readonly string[] };

export type DailySessionSettingsSnapshot = Extract<
  DailySessionSettingsResolution,
  { status: 'ready' }
>;

export class DailySessionSettingsValidationError extends Error {
  public readonly code = 'USER_SETTINGS_VALIDATION_FAILED' as const;

  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid Daily Session settings: ${issues.join('; ')}`);
    this.name = 'DailySessionSettingsValidationError';
  }
}

export class DailySessionSettingsRevisionConflictError extends Error {
  public readonly code = 'USER_SETTINGS_REVISION_CONFLICT' as const;

  public constructor(
    public readonly expectedPersistenceRevision: number,
    public readonly currentPersistenceRevision: number,
  ) {
    super(
      `Daily Session settings revision ${String(expectedPersistenceRevision)} is stale; current revision is ${String(currentPersistenceRevision)}.`,
    );
    this.name = 'DailySessionSettingsRevisionConflictError';
  }
}

export const DEFAULT_DAILY_SESSION_LAUNCH: DailySessionLaunchSettings = {
  provider: LocalRunProvider.Codex,
  model: 'gpt-5.6-luna',
  reasoningEffort: LocalReasoningEffort.Xhigh,
};

export const DEFAULT_DAILY_SESSION_SETTINGS_INPUT: PersistedDailySessionSettings = {
  enabled: true,
  countThreshold: DEFAULT_EVENT_THRESHOLD,
  eventTypes: DEFAULT_TRIGGER_CONFIG.rules.map((rule) => rule.eventType),
};

export const dailySessionSettingsInputFromTriggerConfig = (
  triggerConfig: TriggerConfig,
): PersistedDailySessionSettings => {
  const configuredEventTypes = triggerConfig.rules
    .filter((rule) => rule.enabled !== false)
    .map((rule) => rule.eventType);
  return {
    enabled: true,
    countThreshold: triggerConfig.eventThreshold ?? DEFAULT_EVENT_THRESHOLD,
    eventTypes:
      configuredEventTypes.length > 0
        ? configuredEventTypes
        : DEFAULT_DAILY_SESSION_SETTINGS_INPUT.eventTypes,
  };
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const resolveDailySessionSettings = (persisted: unknown): DailySessionSettingsResolution => {
  const parsed = persistedDailySessionSettingsSchema.safeParse(persisted);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`,
      ),
    };
  }

  const launchFields = ['provider', 'model', 'reasoningEffort'] as const;
  const presentLaunchFields = launchFields.filter((field) => hasOwn(parsed.data, field));
  if (presentLaunchFields.length > 0 && presentLaunchFields.length < launchFields.length) {
    const missing = launchFields.filter((field) => !hasOwn(parsed.data, field));
    return {
      status: 'invalid',
      issues: [`launch selection is incomplete; missing ${missing.join(', ')}`],
    };
  }

  const usedDefaultLaunch = presentLaunchFields.length === 0;
  const launch: DailySessionLaunchSettings = usedDefaultLaunch
    ? DEFAULT_DAILY_SESSION_LAUNCH
    : {
        provider: parsed.data.provider!,
        model: parsed.data.model!,
        reasoningEffort: parsed.data.reasoningEffort!,
      };
  return {
    status: 'ready',
    usedDefaultLaunch,
    effectiveValueSource: 'persisted',
    persistenceRevision: 0,
    settings: {
      enabled: parsed.data.enabled,
      countThreshold: parsed.data.countThreshold,
      eventTypes: [...new Set(parsed.data.eventTypes)],
      ...launch,
    },
  };
};

interface DailySessionSettingsStoreDependencies {
  logger: ServerLogger;
  filePath?: string;
}

interface NormalizedSettingsFile {
  projects: Record<
    string,
    { settings: PersistedDailySessionSettings; persistenceRevision: number }
  >;
}

/** Owns durable, project-keyed Daily Session monitor settings. */
export class DailySessionSettingsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: DailySessionSettingsStoreDependencies) {
    this.filePath = dependencies.filePath ?? path.join(resolveBaseDir(), SETTINGS_FILENAME);
  }

  public async load(
    projectId: string,
    fallback: PersistedDailySessionSettings = DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
  ): Promise<DailySessionSettingsResolution> {
    let persisted: unknown;
    let persistenceRevision = 0;
    try {
      const file = await this.readSettingsFile();
      const project = file.projects[projectId];
      persisted = project?.settings;
      persistenceRevision = project?.persistenceRevision ?? 0;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.logger.error('daily_session.settings.load_failed', {
          projectId,
          error: message,
          filePath: this.filePath,
        });
        return { status: 'invalid', issues: [message] };
      }
    }

    const missing = persisted === undefined;
    const resolution = resolveDailySessionSettings(missing ? fallback : persisted);
    if (resolution.status === 'invalid') {
      this.dependencies.logger.error('daily_session.settings.invalid', {
        projectId,
        issues: resolution.issues,
      });
      return resolution;
    }
    const snapshot: DailySessionSettingsSnapshot = {
      ...resolution,
      effectiveValueSource: missing ? 'default' : 'persisted',
      persistenceRevision,
      settings: resolution.settings,
    };
    this.dependencies.logger.info('daily_session.settings.loaded', {
      projectId,
      source: snapshot.effectiveValueSource,
      persistenceRevision: snapshot.persistenceRevision,
      launchSource: snapshot.usedDefaultLaunch ? 'daily_session_default' : 'persisted_selection',
      enabled: snapshot.settings.enabled,
      countThreshold: snapshot.settings.countThreshold,
      eventTypeCount: snapshot.settings.eventTypes.length,
      provider: snapshot.settings.provider,
      model: snapshot.settings.model,
      reasoningEffort: snapshot.settings.reasoningEffort,
    });
    return snapshot;
  }

  public async replace(
    projectId: string,
    expectedPersistenceRevision: number,
    settings: PersistedDailySessionSettings,
  ): Promise<DailySessionSettingsSnapshot> {
    const resolution = resolveDailySessionSettings(settings);
    if (resolution.status === 'invalid') {
      this.dependencies.logger.error('daily_session.settings.persistence_rejected', {
        projectId,
        issues: resolution.issues,
      });
      throw new DailySessionSettingsValidationError(resolution.issues);
    }

    const operation = this.writeQueue.then(async (): Promise<DailySessionSettingsSnapshot> => {
      const file = await this.readSettingsFile();
      const current = file.projects[projectId];
      const currentPersistenceRevision = current?.persistenceRevision ?? 0;
      if (currentPersistenceRevision !== expectedPersistenceRevision) {
        this.dependencies.logger.warn('daily_session.settings.revision_conflict', {
          projectId,
          expectedPersistenceRevision,
          currentPersistenceRevision,
        });
        throw new DailySessionSettingsRevisionConflictError(
          expectedPersistenceRevision,
          currentPersistenceRevision,
        );
      }
      const persistenceRevision = currentPersistenceRevision + 1;
      const normalizedSettings: PersistedDailySessionSettings = {
        ...resolution.settings,
        eventTypes: [...resolution.settings.eventTypes],
      };
      file.projects[projectId] = { settings: normalizedSettings, persistenceRevision };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(
        temporaryPath,
        JSON.stringify({ version: SETTINGS_VERSION, projects: file.projects }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.filePath);
      this.dependencies.logger.info('daily_session.settings.persisted', {
        projectId,
        filePath: this.filePath,
        persistenceRevision,
        launchSource: resolution.usedDefaultLaunch
          ? 'daily_session_default'
          : 'persisted_selection',
      });
      return {
        ...resolution,
        effectiveValueSource: 'persisted',
        persistenceRevision,
        settings: resolution.settings,
      };
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Backward-compatible name for callers that already use the store directly. */
  public async persist(
    projectId: string,
    settings: PersistedDailySessionSettings,
    expectedPersistenceRevision = 0,
  ): Promise<DailySessionSettingsSnapshot> {
    return this.replace(projectId, expectedPersistenceRevision, settings);
  }

  private async readSettingsFile(): Promise<NormalizedSettingsFile> {
    try {
      const contents = await fs.readFile(this.filePath, 'utf8');
      const parsed = persistedSettingsFileSchema.safeParse(JSON.parse(contents));
      if (!parsed.success) {
        throw new Error('Existing Daily Session settings file is invalid.');
      }
      const projects: NormalizedSettingsFile['projects'] = {};
      for (const [projectId, rawProject] of Object.entries(parsed.data.projects)) {
        if (parsed.data.version === SETTINGS_VERSION) {
          const record = persistedProjectSettingsRecordSchema.safeParse(rawProject);
          if (!record.success) {
            throw new Error(`Existing Daily Session settings for ${projectId} are invalid.`);
          }
          const resolution = resolveDailySessionSettings(record.data.settings);
          if (resolution.status === 'invalid') {
            throw new Error(
              `Existing Daily Session settings for ${projectId} are invalid: ${resolution.issues.join('; ')}`,
            );
          }
          projects[projectId] = {
            settings: {
              ...resolution.settings,
              eventTypes: [...resolution.settings.eventTypes],
            },
            persistenceRevision: record.data.persistenceRevision,
          };
          continue;
        }

        const resolution = resolveDailySessionSettings(rawProject);
        if (resolution.status === 'invalid') {
          throw new Error(
            `Existing Daily Session settings for ${projectId} are invalid: ${resolution.issues.join('; ')}`,
          );
        }
        projects[projectId] = {
          settings: {
            ...resolution.settings,
            eventTypes: [...resolution.settings.eventTypes],
          },
          persistenceRevision: 0,
        };
      }
      return { projects };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { projects: {} };
      }
      throw error;
    }
  }
}
