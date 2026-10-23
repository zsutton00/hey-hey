import {
  RunRetentionSettingsStore,
  type RunRetentionSetting,
} from '../run-store/run-retention-settings';

export const RUN_RETENTION_USAGE = `Usage: heyhey run-retention [get | set <days> | disable]`;

export const runRunRetentionCommand = async (
  args: readonly string[],
  dependencies: {
    settings?: RunRetentionSettingsStore;
    log?: (message: string) => void;
    logError?: (message: string) => void;
  } = {},
): Promise<boolean> => {
  const settings = dependencies.settings ?? new RunRetentionSettingsStore();
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;
  const [action = 'get', value, ...extra] = args;
  if (extra.length > 0 || (action !== 'set' && value !== undefined)) {
    logError(RUN_RETENTION_USAGE);
    return false;
  }
  let next: RunRetentionSetting | null = null;
  if (action === 'set') {
    const days = Number(value);
    if (!value || !Number.isInteger(days) || days <= 0) {
      logError('Run retention days must be a positive integer.');
      return false;
    }
    next = { enabled: true, days };
  } else if (action === 'disable') {
    next = { enabled: false };
  } else if (action !== 'get') {
    logError(RUN_RETENTION_USAGE);
    return false;
  }
  if (next) await settings.set(next);
  const current = next ?? (await settings.load());
  log(current.enabled ? `Automatic Run retention: ${String(current.days)} days` : 'Automatic Run retention: disabled');
  return true;
};
