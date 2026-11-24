import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acpResultSchemas } from '../../agents/providers/antigravity/acp-schemas';
import {
  AntigravityNotReadyError,
  parsePrintOutput,
} from '../../agents/providers/antigravity/antigravity-readiness';
import { parseAntigravitySkills } from '../../agents/providers/antigravity/antigravity-skill-catalog';
import { antigravityUsageFromQuota } from '../../provider-usage/antigravity-usage';
import { antigravityModelsFromSession } from './antigravity-models';

const FIXTURES = join(__dirname, '../../agent-runtime/node/__fixtures__/antigravity');

const printRecording = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    argv: string[];
    stdout: string;
    stderr: string;
  };

const recordedSession = () => {
  for (const line of readFileSync(join(FIXTURES, 'quick.ndjson'), 'utf8').split('\n')) {
    const frame = (JSON.parse(line || 'null') as { frame?: { result?: unknown } } | null)?.frame;
    const parsed = acpResultSchemas['session/new'].safeParse(frame?.result);
    if (parsed.success) {
      return parsed.data;
    }
  }
  throw new Error('quick.ndjson has no session/new result');
};

describe('Antigravity reads against recorded agy output', () => {
  it('lists the models and thinking levels agy reported', () => {
    const session = recordedSession();
    const { models, skipped } = antigravityModelsFromSession(session);

    expect(skipped).toEqual([]);
    expect(models.map((model) => model.id)).toEqual(
      session.configOptions?.find((option) => option.id === 'model')?.options?.map((o) => o.value),
    );
    const withLevels = models.filter((model) => model.efforts.length > 0);
    expect(withLevels.length).toBeGreaterThan(0);
    for (const model of models) {
      for (const effort of model.efforts) {
        const launchable = session.models?.availableModels?.map((m) => m.modelId);
        expect(launchable).toContain(`${model.id}-${effort}`);
      }
    }
    expect(models.some((model) => model.efforts.length === 0)).toBe(true);
  });

  it('fails a signed-out read with the not-signed-in cause', () => {
    const recording = printRecording('signed-out-models.json');
    expect(() => parsePrintOutput('/models', recording.stdout, recording.stderr)).toThrow(
      AntigravityNotReadyError,
    );
    try {
      parsePrintOutput('/models', recording.stdout, recording.stderr);
    } catch (error) {
      expect((error as AntigravityNotReadyError).cause_).toBe('not_signed_in');
    }
  });

  it('reads the skills agy lists', () => {
    const recording = printRecording('models-skills.json');
    const { commandData } = parsePrintOutput('/skills', recording.stdout, recording.stderr);
    const catalog = parseAntigravitySkills(commandData);

    expect(catalog.errors).toEqual([]);
    expect(catalog.skills.map((skill) => skill.name)).toContain('swarm');
    expect(catalog.skills.every((skill) => skill.description.length > 0)).toBe(true);
    // Every skill in the recording ships with agy, so none is the user's.
    expect(new Set(catalog.skills.map((skill) => skill.catalogScope))).toEqual(new Set(['system']));
  });

  it('turns the recorded quota into five-hour and weekly windows', () => {
    const recording = printRecording('quota-before-quota.json');
    const { commandData } = parsePrintOutput('/quota', recording.stdout, recording.stderr);
    const usage = antigravityUsageFromQuota(commandData, '2026-11-20T07:20:00.000Z');

    expect(usage.fiveHour?.usedPercent).toBeCloseTo(4.58, 1);
    expect(usage.fiveHour?.resetsAt).toBe('2026-11-20T08:29:32Z');
    expect(usage.weekly?.usedPercent).toBeCloseTo(1.31, 1);
  });

  it('shows the same limits whatever order agy lists the model groups in', () => {
    const recording = printRecording('quota-before-quota.json');
    const { commandData } = parsePrintOutput('/quota', recording.stdout, recording.stderr);
    const { groups } = commandData as { groups: unknown[] };
    const observedAt = '2026-11-20T07:20:00.000Z';

    expect(antigravityUsageFromQuota({ groups: [...groups].reverse() }, observedAt)).toEqual(
      antigravityUsageFromQuota(commandData, observedAt),
    );
  });

  it('reports no quota windows when agy lists none', () => {
    const usage = antigravityUsageFromQuota({ groups: [] }, '2026-11-20T07:20:00.000Z');
    expect(usage.fiveHour).toBeNull();
    expect(usage.weekly).toBeNull();
  });
});
