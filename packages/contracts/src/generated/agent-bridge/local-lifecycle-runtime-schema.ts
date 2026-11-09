/**
 * Auto-generated from specs/agent-bridge/openapi.yaml.
 * Do not edit manually; regenerate from the OpenAPI source.
 */
import type { LocalLifecycleWork } from './models.js';
export type LocalLifecycleRuntimeSchemaTypes = {
  LocalLifecycleWork: LocalLifecycleWork;
};
export const localLifecycleRuntimeSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "LocalLifecycleWork": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "runIds"
      ],
      "properties": {
        "runIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
};
