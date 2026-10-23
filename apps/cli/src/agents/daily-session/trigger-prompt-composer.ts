import type { ServerLogger } from '../../server/logger';
import type { DeltaResult } from './delta-calculator';

function composeSnapshotSection(delta: DeltaResult): string {
  const parts: string[] = [];

  parts.push(
    `## Trigger Snapshot\n\n` +
      `Recent activity occurred (${delta.signalCount} events). ` +
      `A full activity snapshot is provided below. ` +
      `Focus on the most recent and impactful changes.`,
  );

  if (delta.activity.length > 0) {
    parts.push(
      `**Directive:** Scan the activity snapshot for status transitions, blocked items, ` +
        `and newly created work. Prioritize items that require user action over informational updates. ` +
        `Group your analysis by feature area.\n\n` +
        '```json\n' +
        JSON.stringify(delta.activity, null, 2) +
        '\n```',
    );
  }

  return parts.join('\n\n');
}

/**
 * Mission statement prepended to trigger-initiated sessions.
 * Frames the agent's role and expected output format.
 */
export const triggerMissionStatement = `## Mission

You are producing a **daily project briefing** — a concise, actionable summary of recent project activity for the user.

**Your output must be:**
1. A structured briefing, not a raw changelog — synthesize and interpret the data.
2. Priority-ordered: items requiring user action (blocked tasks, overdue items, proposals awaiting review) come first; informational updates come last.
3. Grouped by feature area or entity, not presented as a flat chronological list.
4. Directive-driven: for each group of changes, provide specific analysis — summarize progress, flag blockers, surface decisions needing review, identify drift from stated goals.

**You must not:** simply echo the data back. Add judgment, context, and recommendations.`;

export interface ComposeTriggerPromptOptions {
  logger?: ServerLogger | undefined;
}

/**
 * Compose the trigger snapshot into a structured prompt section: a header
 * noting how many events drove the firing, followed by the full activity
 * snapshot and a directive for analyzing it.
 */
export function composeTriggerPromptSection(
  delta: DeltaResult,
  options: ComposeTriggerPromptOptions = {},
): string {
  const { logger } = options;
  const result = composeSnapshotSection(delta);

  logger?.info('prompt-composer.composed', {
    signalCount: delta.signalCount,
    activityCount: delta.activity.length,
    promptLength: result.length,
  });

  return result;
}
