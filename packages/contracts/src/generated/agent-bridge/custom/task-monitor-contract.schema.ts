/* This file is generated from OpenAPI by scripts/task-monitor-contract.js. */
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
          "description": "Worktree materialization request forwarded to the Agent Bridge runtime.\n"
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

export const taskMonitorCoordinatorDecisionJsonSchema = {
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "REQUEST_REVIEW"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale",
        "guidance"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "REQUEST_CHANGES"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        },
        "guidance": {
          "type": "string",
          "minLength": 1,
          "maxLength": 5000
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "ACCEPT_TASK"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "WAIT"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale",
        "guidance"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "REQUEST_JUDGMENT"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        },
        "guidance": {
          "type": "string",
          "minLength": 1,
          "maxLength": 5000
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action",
        "rationale",
        "failureContext"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "HALT"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        },
        "failureContext": {
          "type": "string",
          "minLength": 1,
          "maxLength": 5000
        }
      }
    }
  ],
  "discriminator": {
    "propertyName": "action",
    "mapping": {
      "REQUEST_REVIEW": "#/components/schemas/LocalTaskMonitorRequestReviewDecision",
      "REQUEST_CHANGES": "#/components/schemas/LocalTaskMonitorRequestChangesDecision",
      "ACCEPT_TASK": "#/components/schemas/LocalTaskMonitorAcceptTaskDecision",
      "WAIT": "#/components/schemas/LocalTaskMonitorWaitDecision",
      "REQUEST_JUDGMENT": "#/components/schemas/LocalTaskMonitorRequestJudgmentDecision",
      "HALT": "#/components/schemas/LocalTaskMonitorHaltDecision"
    }
  }
} as const;
