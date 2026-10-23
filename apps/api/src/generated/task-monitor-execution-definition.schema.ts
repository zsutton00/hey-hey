/* This file is generated from OpenAPI by scripts/generate-task-monitor-schema.js. */
/* eslint-disable @typescript-eslint/no-unused-vars */

/* Do not edit by hand. */

export const taskMonitorExecutionDefinitionJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "executionPlan",
    "launchPolicy",
    "cursor"
  ],
  "properties": {
    "executionPlan": {
      "type": "array",
      "description": "Ordered executable task nodes. Array position is the persisted execution order.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "taskId",
          "dependsOnTaskIds",
          "launchConfiguration"
        ],
        "properties": {
          "taskId": {
            "type": "string",
            "format": "uuid"
          },
          "dependsOnTaskIds": {
            "type": "array",
            "description": "Canonical task identities that block this node.",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "launchConfiguration": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "method",
              "provider",
              "model",
              "reasoningEffort"
            ],
            "properties": {
              "method": {
                "type": "string",
                "enum": [
                  "plan",
                  "open",
                  "quick"
                ]
              },
              "provider": {
                "type": "string",
                "enum": [
                  "claude",
                  "codex",
                  "opencode"
                ]
              },
              "model": {
                "type": "string",
                "minLength": 1
              },
              "reasoningEffort": {
                "type": "string",
                "enum": [
                  "none",
                  "minimal",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                  "ultra",
                  "default"
                ]
              },
              "fastMode": {
                "type": "boolean",
                "description": "Explicit Fast mode intent for catalog-supported provider/model selections; omit for unsupported selections."
              }
            }
          },
          "agentSessionId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          }
        }
      }
    },
    "launchPolicy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "terminalSupervision"
      ],
      "properties": {
        "worktree": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "enabled"
          ],
          "properties": {
            "enabled": {
              "type": "boolean",
              "enum": [
                true
              ]
            },
            "branch": {
              "type": "string",
              "minLength": 1
            }
          },
          "description": "Optional monitor-level worktree request applied to every selected-task launch."
        },
        "terminalSupervision": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mode"
          ],
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "AGENT_DECIDES",
                "REQUIRE_REVIEW"
              ]
            }
          }
        }
      }
    },
    "cursor": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;
