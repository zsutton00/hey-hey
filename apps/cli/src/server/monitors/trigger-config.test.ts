import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn() } }));

import fs from 'node:fs/promises';
import { dailySessionSettingsInputFromTriggerConfig } from './daily-session-settings';
import {
  DEFAULT_EVENT_THRESHOLD,
  DEFAULT_TRIGGER_CONFIG,
  loadTriggerConfig,
} from './trigger-config';

const readFileMock = fs.readFile as unknown as ReturnType<typeof vi.fn>;

describe('loadTriggerConfig', () => {
  beforeEach(() => readFileMock.mockReset());

  it('falls back to defaults when the config file is absent or unparseable', async () => {
    // Unparseable contents drive the same fallback path as a missing file.
    readFileMock.mockResolvedValue('}{ not json');
    const config = await loadTriggerConfig();
    expect(config.eventThreshold).toBe(DEFAULT_EVENT_THRESHOLD);
    expect(config.rules).toEqual(DEFAULT_TRIGGER_CONFIG.rules);
  });

  it('merges a partial user config over defaults and preserves the default eventThreshold', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ debounceMs: 5, quietHours: { start: '22:00', end: '06:00' } }),
    );
    const config = await loadTriggerConfig();
    expect(config.debounceMs).toBe(5);
    expect(config.quietHours).toEqual({ start: '22:00', end: '06:00' });
    // Not overridden by the partial — carried forward from defaults.
    expect(config.eventThreshold).toBe(DEFAULT_EVENT_THRESHOLD);
    expect(config.rules).toEqual(DEFAULT_TRIGGER_CONFIG.rules);
  });

  it('merges rules by id, overriding matches and appending new ones', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        rules: [
          { id: 'task-created', eventType: 'task.created', severity: 'critical' },
          { id: 'custom-rule', eventType: 'x.y', severity: 'low' },
        ],
      }),
    );
    const config = await loadTriggerConfig();
    expect(config.rules.find((r) => r.id === 'task-created')?.severity).toBe('critical');
    expect(config.rules.some((r) => r.id === 'custom-rule')).toBe(true);
  });

  it('maps legacy trigger rules into the default project settings seed', () => {
    expect(
      dailySessionSettingsInputFromTriggerConfig({
        debounceMs: 0,
        eventThreshold: 4,
        rules: [
          { id: 'enabled', eventType: 'task.created', severity: 'low' },
          {
            id: 'disabled',
            eventType: 'task.status_changed',
            severity: 'low',
            enabled: false,
          },
        ],
      }),
    ).toEqual({
      enabled: true,
      countThreshold: 4,
      eventTypes: ['task.created'],
    });
  });
});
