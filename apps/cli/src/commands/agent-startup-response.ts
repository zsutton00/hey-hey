import {
  parseStartupSessionPlanResponseFromText,
  type StartupSessionPlanResponse,
} from '@hey-hey/ui-common/agents';
import type { AgenticSessionEvent } from '../session/index';
import { extractLatestAssistantResponseText } from './agent-session-event-helpers';

interface StartupPlanValidationMetrics {
  steps: number;
  discrepancies: number;
  clarificationQuestions: number;
}

export type StartupPlanValidationResult =
  | {
      ok: true;
      parsed: StartupSessionPlanResponse;
      metrics: StartupPlanValidationMetrics;
    }
  | {
      ok: false;
      error: string;
    };

export const validateStartupPlanFromEvents = (input: {
  events: AgenticSessionEvent[];
  baselineEventCount: number;
}): StartupPlanValidationResult => {
  const responseText = extractLatestAssistantResponseText(input.events, input.baselineEventCount);
  if (!responseText) {
    return {
      ok: false,
      error: 'No assistant response was captured for startup validation.',
    };
  }

  const parsed = parseStartupSessionPlanResponseFromText(responseText);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
    };
  }

  return {
    ok: true,
    parsed: parsed.value,
    metrics: {
      steps: parsed.value.executionPlan.length,
      discrepancies: parsed.value.discrepancies.length,
      clarificationQuestions: parsed.value.clarificationQuestions.length,
    },
  };
};
