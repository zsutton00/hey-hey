const REDACTED_VALUE = '[REDACTED]';
const DEFAULT_MAX_STRING_LENGTH = 512;
const DEFAULT_REDACTION_KEYS = [
  'api_key',
  'apikey',
  'authorization',
  'blob',
  'cookie',
  'diff',
  'key',
  'password',
  'secret',
  'token',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const shouldRedactKey = (key: string, redactedKeys: ReadonlySet<string>): boolean => {
  const normalized = normalizeKey(key);
  for (const candidate of redactedKeys) {
    if (!candidate) {
      continue;
    }
    if (normalized === candidate || normalized.includes(candidate)) {
      return true;
    }
  }
  return false;
};

export interface AgentEventLogRedactionConfig {
  enabled: boolean;
  maxStringLength: number;
  redactedKeys: ReadonlySet<string>;
}

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseBooleanFlag = (value: string | undefined): boolean | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off') {
    return false;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'on') {
    return true;
  }
  return null;
};

const parseAdditionalKeys = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((key) => normalizeKey(key))
    .filter((key) => key.length > 0);
};

export const loadAgentEventLogRedactionConfig = (): AgentEventLogRedactionConfig => {
  const enabledFromEnv = parseBooleanFlag(process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION']);
  const maxStringLength =
    parsePositiveInteger(process.env['HEYHEY_AGENT_EVENT_LOG_MAX_STRING_LENGTH']) ??
    DEFAULT_MAX_STRING_LENGTH;
  const redactedKeys = new Set<string>(DEFAULT_REDACTION_KEYS);
  for (const additionalKey of parseAdditionalKeys(
    process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION_KEYS'],
  )) {
    redactedKeys.add(additionalKey);
  }

  return {
    enabled: enabledFromEnv ?? true,
    maxStringLength,
    redactedKeys,
  };
};

const truncateString = (value: string, maxStringLength: number): string => {
  if (value.length <= maxStringLength) {
    return value;
  }
  return `${value.slice(0, maxStringLength)}...`;
};

const redactValue = (
  value: unknown,
  config: AgentEventLogRedactionConfig,
  parentKey: string | null,
): unknown => {
  if (!config.enabled) {
    if (typeof value === 'string') {
      return truncateString(value, config.maxStringLength);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => redactValue(entry, config, parentKey));
    }
    if (isRecord(value)) {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        output[key] = redactValue(entry, config, key);
      }
      return output;
    }
    return value;
  }

  if (parentKey && shouldRedactKey(parentKey, config.redactedKeys)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    return truncateString(value, config.maxStringLength);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, config, parentKey));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = redactValue(entry, config, key);
    }
    return output;
  }

  return value;
};

export const redactAgentEventForLog = (
  value: Record<string, unknown>,
  config: AgentEventLogRedactionConfig,
): Record<string, unknown> => {
  const redacted = redactValue(value, config, null);
  if (!isRecord(redacted)) {
    return {};
  }
  return redacted;
};
