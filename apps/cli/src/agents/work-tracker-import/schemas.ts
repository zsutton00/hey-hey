import { z } from 'zod';
import type {
  WorkTrackerImportCompletion,
  WorkTrackerImportRequest,
} from '../../shared/agent-bridge-contract/generated/api';
import { createAgentBridgeRuntimeValidator } from '../../shared/agent-bridge-contract/runtime-schema-validator';

const requestValidator = createAgentBridgeRuntimeValidator<WorkTrackerImportRequest>(
  'WorkTrackerImportRequest',
);
const completionValidator = createAgentBridgeRuntimeValidator<WorkTrackerImportCompletion>(
  'WorkTrackerImportCompletion',
);

export const workTrackerRequestSchema = z.custom<WorkTrackerImportRequest>(
  (value) => requestValidator(value),
  { message: 'Invalid work-tracker import request.' },
);
const completionSchema = z.custom<WorkTrackerImportCompletion>(
  (value) => completionValidator(value),
  { message: 'Invalid work-tracker import completion.' },
);

export function parseWorkTrackerCompletion(
  text: string,
): { ok: true; value: WorkTrackerImportCompletion } | { ok: false; error: string } {
  const json = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1] ?? text.trim();
  try {
    const parsed = completionSchema.safeParse(JSON.parse(json));
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: 'Invalid work-tracker import completion.' };
  } catch {
    return { ok: false, error: 'Expected a JSON work-tracker import completion.' };
  }
}
