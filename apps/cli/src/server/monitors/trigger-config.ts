import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveBaseDir } from '../../session/paths';

type TriggerSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A single rule mapping a platform event type to a watched activity signal. */
interface TriggerRule {
  /** Unique identifier for this rule. */
  id: string;
  /** Event type to match (exact string, e.g. "task.status_changed"). */
  eventType: string;
  /** Severity assigned when this rule fires. */
  severity: TriggerSeverity;
  /** Whether this rule is active. Defaults to true when omitted. */
  enabled?: boolean;
  /** Per-rule debounce override in milliseconds. Falls back to global debounce. */
  debounceMs?: number;
}

/** Top-level monitor configuration, loadable from a JSON file. */
export interface TriggerConfig {
  /** Activity event types the daily-session monitor counts toward its gate. */
  rules: TriggerRule[];
  /** Global debounce interval in milliseconds applied by the pre-subscribe filter. */
  debounceMs: number;
  /** Number of events to accumulate before the daily-session gate fires. Defaults to 20. */
  eventThreshold?: number;
  /** Quiet-hours window. Platform events are suppressed between start and end (HH:MM, 24h). */
  quietHours?: {
    start: string;
    end: string;
  };
}

/** 30-second global debounce. */
const DEFAULT_DEBOUNCE_MS = 30_000;

/** Fire the daily-session monitor after this many platform activity events accumulate. */
export const DEFAULT_EVENT_THRESHOLD = 20;

/**
 * Sensible defaults that work out of the box. Users can override any part of
 * this via their trigger-rules.json config file.
 */
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  debounceMs: DEFAULT_DEBOUNCE_MS,
  eventThreshold: DEFAULT_EVENT_THRESHOLD,
  rules: [
    { id: 'agent-session-created', eventType: 'agent_session.created', severity: 'medium' },
    { id: 'agent-session-deleted', eventType: 'agent_session.deleted', severity: 'medium' },
    {
      id: 'agent-session-status-changed',
      eventType: 'agent_session.status_changed',
      severity: 'high',
    },
    { id: 'task-status-changed', eventType: 'task.status_changed', severity: 'high' },
    { id: 'task-created', eventType: 'task.created', severity: 'medium' },
  ],
};

const CONFIG_FILENAME = 'trigger-rules.json';

const resolveConfigPath = (): string => path.join(resolveBaseDir(), CONFIG_FILENAME);

/**
 * Deep-merge a partial user config over defaults. Rules are merged by id:
 * user rules override matching default rules and append new ones.
 */
const mergeConfig = (defaults: TriggerConfig, partial: Partial<TriggerConfig>): TriggerConfig => {
  const mergedRulesById = new Map<string, TriggerRule>();
  for (const rule of defaults.rules) {
    mergedRulesById.set(rule.id, rule);
  }
  if (partial.rules) {
    for (const rule of partial.rules) {
      mergedRulesById.set(rule.id, { ...mergedRulesById.get(rule.id), ...rule });
    }
  }

  const config: TriggerConfig = {
    debounceMs: partial.debounceMs ?? defaults.debounceMs,
    rules: [...mergedRulesById.values()],
  };
  const eventThreshold = partial.eventThreshold ?? defaults.eventThreshold;
  if (eventThreshold !== undefined) {
    config.eventThreshold = eventThreshold;
  }
  const quietHours = partial.quietHours ?? defaults.quietHours;
  if (quietHours) {
    config.quietHours = quietHours;
  }
  return config;
};

/**
 * Load monitor config from the user's data directory. Falls back to defaults
 * when the file doesn't exist or is unparseable.
 */
export const loadTriggerConfig = async (): Promise<TriggerConfig> => {
  const configPath = resolveConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TriggerConfig>;
    return mergeConfig(DEFAULT_TRIGGER_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_TRIGGER_CONFIG };
  }
};
