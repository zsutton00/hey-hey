import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { TaskMonitorExecutionDefinition } from "../../api";
import { taskMonitorExecutionDefinitionJsonSchema } from "../../generated/task-monitor-contract.schema";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

export const taskMonitorExecutionDefinitionSchema: ValidateFunction<TaskMonitorExecutionDefinition> =
  ajv.compile<TaskMonitorExecutionDefinition>(
    taskMonitorExecutionDefinitionJsonSchema
  );

export const parseTaskMonitorExecutionDefinition = (
  content: string
): TaskMonitorExecutionDefinition => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The execution definition contains malformed JSON.");
  }

  if (!taskMonitorExecutionDefinitionSchema(parsed)) {
    throw new Error(
      "The execution definition does not match the Task Monitor schema."
    );
  }
  return parsed;
};
