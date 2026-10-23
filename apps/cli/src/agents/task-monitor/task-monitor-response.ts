import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { taskMonitorCoordinatorDecisionJsonSchema } from '../../generated/task-monitor-contract.schema';
import type { LocalTaskMonitorCoordinatorDecision } from '../../shared/agent-bridge-contract/generated/api';

export type TaskMonitorDecisionParseResult =
  | { ok: true; value: LocalTaskMonitorCoordinatorDecision }
  | {
      ok: false;
      error: {
        code: 'EMPTY_OUTPUT' | 'INVALID_ENVELOPE' | 'INVALID_JSON' | 'SCHEMA_VALIDATION_FAILED';
        message: string;
        issues?: readonly string[];
      };
    };

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

const validateDecision: ValidateFunction<LocalTaskMonitorCoordinatorDecision> = ajv.compile(
  taskMonitorCoordinatorDecisionJsonSchema,
);

const fencedJsonPattern = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u;

const formatIssue = (issue: ErrorObject): string =>
  `${issue.instancePath || '/'} ${issue.message ?? 'is invalid'}`;

const extractSoleJsonValue = (
  text: string,
): { ok: true; json: string } | { ok: false; message: string } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: 'Task Monitor coordinator output is empty.' };
  }

  if (trimmed.startsWith('```') || trimmed.endsWith('```')) {
    const fenced = trimmed.match(fencedJsonPattern);
    if (!fenced?.[1] || fenced[1].includes('```')) {
      return {
        ok: false,
        message:
          'Task Monitor coordinator output must contain exactly one complete JSON fence with no surrounding text.',
      };
    }
    return { ok: true, json: fenced[1].trim() };
  }

  return { ok: true, json: trimmed };
};

export const parseTaskMonitorDecision = (text: string): TaskMonitorDecisionParseResult => {
  const extracted = extractSoleJsonValue(text);
  if (!extracted.ok) {
    return {
      ok: false,
      error: {
        code: text.trim() ? 'INVALID_ENVELOPE' : 'EMPTY_OUTPUT',
        message: extracted.message,
      },
    };
  }

  let parsed: object;
  try {
    const value: unknown = JSON.parse(extracted.json);
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
      return {
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Task Monitor coordinator output must be exactly one JSON object.',
        },
      };
    }
    parsed = value;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: `Task Monitor coordinator output is not one complete JSON value: ${
          error instanceof Error ? error.message : 'JSON parsing failed'
        }`,
      },
    };
  }

  if (!validateDecision(parsed)) {
    // Full union validation remains authoritative; report only the selected action's branch.
    const action = 'action' in parsed ? parsed.action : null;
    const branchIndex = taskMonitorCoordinatorDecisionJsonSchema.oneOf.findIndex((branch) =>
      branch.properties.action.enum.some((candidate) => candidate === action),
    );
    const errors = validateDecision.errors ?? [];
    const relevant =
      branchIndex < 0
        ? errors
        : errors.filter((issue) => issue.schemaPath.startsWith(`#\/oneOf/${branchIndex}/`));
    const issues = (relevant.length > 0 ? relevant : errors).map(formatIssue);
    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: `Task Monitor coordinator decision does not match LocalTaskMonitorCoordinatorDecision: ${issues.join(
          '; ',
        )}`,
        issues,
      },
    };
  }

  return { ok: true, value: parsed };
};
