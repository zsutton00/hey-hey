import { BadRequestException } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { TaskMonitorExecutionDefinition } from '../../generated/model/taskMonitorExecutionDefinition';
import { taskMonitorExecutionDefinitionJsonSchema } from '../../generated/task-monitor-execution-definition.schema';

export const TASK_MONITOR_TYPE_KEY = 'TASK_MONITOR';
export const TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY =
  'executionDefinition';
export const TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF =
  '#/components/schemas/TaskMonitorExecutionDefinition';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

const validateStructure: ValidateFunction<TaskMonitorExecutionDefinition> =
  ajv.compile<TaskMonitorExecutionDefinition>(
    taskMonitorExecutionDefinitionJsonSchema,
  );

export type TaskMonitorExecutionDefinitionValidationResult =
  | {
      success: true;
      value: TaskMonitorExecutionDefinition;
      canonicalContent: string;
    }
  | {
      success: false;
      message: string;
    };

export function validateTaskMonitorExecutionDefinitionContent(
  content: unknown,
): TaskMonitorExecutionDefinitionValidationResult {
  const parsedJson =
    typeof content === 'string' ? parseJsonString(content) : { value: content };

  if ('error' in parsedJson) {
    return { success: false, message: parsedJson.error };
  }
  if (!validateStructure(parsedJson.value)) {
    return {
      success: false,
      message: formatStructuralIssues(validateStructure.errors),
    };
  }

  const invariantIssues = taskMonitorInvariantIssues(parsedJson.value);
  if (invariantIssues.length > 0) {
    return { success: false, message: invariantIssues.join('; ') };
  }

  return {
    success: true,
    value: parsedJson.value,
    canonicalContent: JSON.stringify(parsedJson.value),
  };
}

export function canonicalizeTaskMonitorExecutionDefinitionContent(
  content: unknown,
): string {
  const result = validateTaskMonitorExecutionDefinitionContent(content);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid task monitor executionDefinition: ${result.message}`,
    );
  }
  return result.canonicalContent;
}

function taskMonitorInvariantIssues(
  definition: TaskMonitorExecutionDefinition,
): string[] {
  const issues: string[] = [];
  const taskIndexes = new Map<string, number>();

  definition.executionPlan.forEach((node, index) => {
    if (taskIndexes.has(node.taskId)) {
      issues.push('executionPlan taskId values must be unique');
      return;
    }
    taskIndexes.set(node.taskId, index);
  });

  definition.executionPlan.forEach((node, index) => {
    if (new Set(node.dependsOnTaskIds).size !== node.dependsOnTaskIds.length) {
      issues.push(
        `executionPlan[${index}].dependsOnTaskIds values must be unique`,
      );
    }

    for (const dependencyTaskId of node.dependsOnTaskIds) {
      const dependencyIndex = taskIndexes.get(dependencyTaskId);
      if (dependencyIndex === undefined) {
        issues.push(
          `executionPlan[${index}].dependsOnTaskIds references a task outside executionPlan`,
        );
      } else if (dependencyIndex >= index) {
        issues.push(
          `executionPlan[${index}].dependsOnTaskIds must reference earlier executionPlan nodes`,
        );
      }
    }
  });

  if (definition.cursor >= definition.executionPlan.length) {
    issues.push('cursor must reference an executionPlan node');
  }

  return [...new Set(issues)];
}

function formatStructuralIssues(
  errors: ErrorObject[] | null | undefined,
): string {
  return (errors ?? [])
    .map((error) => {
      const path = error.instancePath || 'root';
      return `${path}: ${error.message ?? 'is invalid'}`;
    })
    .join('; ');
}

function parseJsonString(
  content: string,
): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(content) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `content is not valid JSON: ${error.message}`
          : 'content is not valid JSON',
    };
  }
}
