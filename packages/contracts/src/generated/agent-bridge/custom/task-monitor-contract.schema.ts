/* This file is generated from OpenAPI by scripts/task-monitor-contract.js. */
/* Do not edit by hand. */

export const taskMonitorExecutionDefinitionJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "executionPlan",
    "launchPolicy",
    "cursor"
  ],
  "properties": {
    "kind": {
      "type": "string",
      "minLength": 1,
      "description": "Key of the kind this monitor runs, declared in the project-effective monitor type's `monitorKinds`. Fixed when the monitor is created.\n"
    },
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
          },
          "operationEvidence": {
            "type": "object",
            "additionalProperties": false,
            "description": "Durable normalized operation result selected from a released Turn, scoped to this entry and its recorded session. coordinatorRunId is present only after coordinator acceptance passes Review admission. Pending results never satisfy coordinator-supervised work. New launches discard this evidence.\n",
            "required": [
              "agentSessionId",
              "turnId",
              "reportId"
            ],
            "properties": {
              "agentSessionId": {
                "type": "string",
                "format": "uuid"
              },
              "turnId": {
                "type": "string",
                "minLength": 1
              },
              "reportId": {
                "type": "string",
                "format": "uuid"
              },
              "coordinatorRunId": {
                "type": "string",
                "minLength": 1
              }
            }
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
            },
            "reviewRuntime": {
              "description": "Optional runtime the Review sub-agent runs on for every Review this monitor requests. Applies only with REQUIRE_REVIEW. Monitor-owned selected-run intent; it holds no session or Review evidence and never changes the task Agent Session's runtime. Absent means Review runs on the task Agent Session's runtime.\n",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "provider",
                "model"
              ],
              "properties": {
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
                  ],
                  "description": "Omitted for models whose catalog entry offers no effort choices."
                },
                "fastMode": {
                  "type": "boolean",
                  "description": "Explicit Fast mode intent for catalog-supported provider/model selections; omit for unsupported selections."
                }
              }
            }
          }
        }
      }
    },
    "coordinatorRuntime": {
      "description": "Optional runtime the monitor's own coordinator runs on. Absent on monitors saved before this setting existed; the provider default applies then.\n",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "provider",
        "model"
      ],
      "properties": {
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
          ],
          "description": "Omitted for models whose catalog entry offers no effort choices."
        },
        "fastMode": {
          "type": "boolean",
          "description": "Explicit Fast mode intent for catalog-supported provider/model selections; omit for unsupported selections."
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
    },
    {
      "type": "object",
      "additionalProperties": false,
      "description": "Approve the pending provider permission request for the exact action and target.",
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "APPROVE_PERMISSION"
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
      "description": "Deny the pending provider permission request.",
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "DENY_PERMISSION"
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
      "description": "Hand the pending request to the human because the monitor cannot judge it safely; rationale is the reason shown to them.",
      "required": [
        "action",
        "rationale"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "ESCALATE_PERMISSION"
          ]
        },
        "rationale": {
          "type": "string",
          "minLength": 1
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
      "HALT": "#/components/schemas/LocalTaskMonitorHaltDecision",
      "APPROVE_PERMISSION": "#/components/schemas/LocalTaskMonitorApprovePermissionDecision",
      "DENY_PERMISSION": "#/components/schemas/LocalTaskMonitorDenyPermissionDecision",
      "ESCALATE_PERMISSION": "#/components/schemas/LocalTaskMonitorEscalatePermissionDecision"
    }
  }
} as const;
