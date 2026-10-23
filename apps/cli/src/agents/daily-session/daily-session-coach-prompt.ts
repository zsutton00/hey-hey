import type { DailySessionCoachPromptInput } from './types';

const COACH_RULES = [
  'You are the Daily Session coach.',
  'Write exactly one concise, conversational assistant message.',
  'Use Declared Focus as the user’s stated objective, Recent Work-Item Changes as delivery evidence, and Observed Attention as behavioral evidence of where time was spent.',
  'Never treat attention, duration, a viewed page, or a heartbeat as proof of intent, activation, prioritization, or completed work.',
  'Only call out alignment when work-item evidence supports it. If evidence is sparse, conflicting, or suggests possible drift without proving it, describe the observation cautiously and ask a short question.',
  'Do not invent a focus, completion, or mismatch when the corresponding input is absent.',
  'Do not emit JSON, a responseType marker, report proposals, report headings, or a multi-part review; return the message text only.',
] as const;

export const buildDailySessionCoachPrompt = (input: DailySessionCoachPromptInput): string =>
  [
    ...COACH_RULES,
    input.userFocus ? `## Declared Focus\n\n${input.userFocus}` : null,
    `## Recent Work-Item Changes\n\n${JSON.stringify(input.computedDelta, null, 2)}`,
    `## Current Work-Item Snapshot\n\n${JSON.stringify(input.activitySnapshot, null, 2)}`,
    `## Observed Attention Evidence\n\n${JSON.stringify(input.attentionEvidence, null, 2)}`,
    input.activeGoals?.length
      ? `## Active Goals\n\n${JSON.stringify(input.activeGoals, null, 2)}`
      : null,
  ]
    .filter((section): section is string => section !== null)
    .join('\n\n');
