import { describe, expect, it } from 'vitest';
import { composeTriggerPromptSection, triggerMissionStatement } from '../trigger-prompt-composer';
import type { DeltaResult } from '../delta-calculator';

describe('composeTriggerPromptSection', () => {
  it('includes the signal count and snapshot explanation', () => {
    const delta: DeltaResult = {
      activity: [],
      signalCount: 25,
      computedAt: '2026-04-08T12:00:00.000Z',
    };

    const result = composeTriggerPromptSection(delta);
    expect(result).toContain('## Trigger Snapshot');
    expect(result).toContain('25 events');
  });

  it('includes activity data as JSON with a directive when present', () => {
    // Minimal stub — only verifying JSON serialization into the prompt, not the DTO shape.
    const activity = [{ id: 'rec-1', type: 'task' }] as unknown as DeltaResult['activity'];
    const delta: DeltaResult = {
      activity,
      signalCount: 30,
      computedAt: '2026-04-08T12:00:00.000Z',
    };

    const result = composeTriggerPromptSection(delta);
    expect(result).toContain('"id": "rec-1"');
    expect(result).toContain('**Directive:**');
    expect(result).toContain('Scan the activity snapshot');
  });

  it('omits the activity JSON block when activity is empty', () => {
    const delta: DeltaResult = {
      activity: [],
      signalCount: 25,
      computedAt: '2026-04-08T12:00:00.000Z',
    };

    const result = composeTriggerPromptSection(delta);
    expect(result).not.toContain('```json');
  });

  describe('triggerMissionStatement', () => {
    it('contains mission heading and key instructions', () => {
      expect(triggerMissionStatement).toContain('## Mission');
      expect(triggerMissionStatement).toContain('daily project briefing');
      expect(triggerMissionStatement).toContain('Priority-ordered');
      expect(triggerMissionStatement).toContain('Grouped by feature area');
    });
  });
});
