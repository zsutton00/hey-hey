/* eslint-disable @typescript-eslint/no-unused-vars */
// Generated from OpenAPI by scripts/generate-project-report-schemas.js. Do not edit.
export const projectReportSchemas = {
  "AgentSessionConfigProjectReportV1": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "type",
      "version",
      "requestId",
      "attemptId",
      "model"
    ],
    "properties": {
      "type": {
        "type": "string",
        "enum": [
          "PROJECT_REPORT"
        ]
      },
      "version": {
        "type": "string",
        "enum": [
          "v1"
        ]
      },
      "requestId": {
        "type": "string",
        "format": "uuid"
      },
      "attemptId": {
        "type": "string",
        "format": "uuid"
      },
      "model": {
        "type": "string",
        "minLength": 1
      },
      "effort": {
        "type": "string",
        "minLength": 1
      },
      "fastMode": {
        "type": "boolean"
      }
    }
  },
  "CreateProjectReportRequestDto": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "question",
      "scope",
      "exclusions",
      "launch",
      "idempotencyKey"
    ],
    "properties": {
      "kind": {
        "type": "string",
        "enum": [
          "PROJECT_REPORT",
          "RELEASE_NOTES"
        ],
        "description": "PROJECT_REPORT answers a question from the project graph only. RELEASE_NOTES reports what shipped: changes merged into selected project repositories, correlated with graph evidence. Only changes that have been merged into each project repository's default branch will be included. It is the only kind with repository access and launches through the release_notes prompt type."
      },
      "serviceIds": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "format": "uuid"
        },
        "description": "Accepted repository selection. Absent on graph-only requests and historical release-note requests whose original selection is unknown."
      },
      "question": {
        "type": "string",
        "minLength": 1,
        "maxLength": 20000
      },
      "preset": {
        "type": "object",
        "description": "Outline-guide provenance retaining the accepted question and edited outline. Applying a guide changes only the outline.",
        "additionalProperties": false,
        "required": [
          "key",
          "prompt",
          "outline"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1
          },
          "prompt": {
            "type": "string",
            "minLength": 1
          },
          "outline": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "scope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "projectId",
          "windowStart",
          "windowEnd",
          "timeZone"
        ],
        "properties": {
          "projectId": {
            "type": "string",
            "format": "uuid"
          },
          "windowStart": {
            "type": "string",
            "format": "date-time"
          },
          "windowEnd": {
            "type": "string",
            "format": "date-time"
          },
          "timeZone": {
            "type": "string",
            "minLength": 1
          },
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "activityTypes": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "VIEWED",
                "UNBLOCKED",
                "NOTIFICATION",
                "AGENT_SESSION_COMPLETED"
              ],
              "description": "Correlated activity category.\n- VIEWED: User focused or viewed an entity.\n- UNBLOCKED: Work progressed because a dependency or blocking condition was resolved.\n- NOTIFICATION: User-visible system or workflow notification tied to entity activity.\n- AGENT_SESSION_COMPLETED: A linked agent session reached COMPLETED status.\n"
            },
            "uniqueItems": true
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "ATTENTION_EVENT",
                "AGENT_SESSION",
                "TASK_RELATIONSHIP",
                "REPORT",
                "SYSTEM"
              ],
              "description": "Source stream that produced the correlated activity item."
            },
            "uniqueItems": true
          },
          "includeAttentionEvents": {
            "type": "boolean",
            "default": false
          }
        },
        "description": "Fixed UTC start-inclusive/end-exclusive window; start must precede end. timeZone is the display IANA timezone. Omitted actor/classification filters include all authorized matching evidence; empty classification arrays select none. Retains canonical queryActivity semantics."
      },
      "exclusions": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "entityType",
            "entityId"
          ],
          "properties": {
            "entityType": {
              "type": "string",
              "enum": [
                "ARTIFACT",
                "INITIATIVE",
                "PROJECT",
                "TASK",
                "MESSAGE",
                "CONVERSATION",
                "DESIGN_DOC",
                "AGENT_SESSION",
                "VALIDATION_SESSION",
                "SERVICE",
                "REPORT",
                "PROPOSAL",
                "IMPLEMENTATION_HINT",
                "USER"
              ],
              "description": "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry."
            },
            "entityId": {
              "type": "string",
              "format": "uuid"
            }
          }
        },
        "uniqueItems": true
      },
      "launch": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "machineId",
          "provider",
          "model",
          "effort"
        ],
        "properties": {
          "machineId": {
            "type": "string",
            "format": "uuid"
          },
          "provider": {
            "type": "string",
            "enum": [
              "claude",
              "codex",
              "opencode"
            ],
            "description": "Provider selected through the existing agent launch configuration."
          },
          "model": {
            "type": "string",
            "minLength": 1
          },
          "effort": {
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
            "type": "boolean"
          }
        },
        "description": "Existing reachable-machine and provider configuration. PROJECT_REPORT requires no Service or repository. RELEASE_NOTES requires machineId to be a ready machine reporting bindings for selected project Services; otherwise launch fails with code SERVICE_REPOSITORIES_UNAVAILABLE and names unavailable Services."
      },
      "idempotencyKey": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "not": {
      "anyOf": [
        {
          "required": [
            "kind"
          ],
          "properties": {
            "kind": {
              "enum": [
                "RELEASE_NOTES"
              ]
            }
          },
          "not": {
            "required": [
              "serviceIds"
            ]
          }
        },
        {
          "required": [
            "serviceIds"
          ],
          "not": {
            "required": [
              "kind"
            ],
            "properties": {
              "kind": {
                "enum": [
                  "RELEASE_NOTES"
                ]
              }
            }
          }
        }
      ]
    },
    "description": "Persist the edited question and reviewed scope before launch. Idempotency is scoped to organization, project and requesting user; reuse with changed input is a conflict. Exclusions remove primary subjects, not necessary authorized context. Empty/all-excluded populations cannot submit. Omitted kind means PROJECT_REPORT."
  },
  "ProjectReportContextBatchRequestDto": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "attemptId",
      "subjects"
    ],
    "properties": {
      "attemptId": {
        "type": "string",
        "format": "uuid"
      },
      "subjects": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "uniqueItems": true,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "entityType",
            "entityId"
          ],
          "properties": {
            "entityType": {
              "type": "string",
              "enum": [
                "ARTIFACT",
                "INITIATIVE",
                "PROJECT",
                "TASK",
                "MESSAGE",
                "CONVERSATION",
                "DESIGN_DOC",
                "AGENT_SESSION",
                "VALIDATION_SESSION",
                "SERVICE",
                "REPORT",
                "PROPOSAL",
                "IMPLEMENTATION_HINT",
                "USER"
              ],
              "description": "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry."
            },
            "entityId": {
              "type": "string",
              "format": "uuid"
            }
          }
        }
      }
    },
    "description": "Included primary subjects of the active attempt whose current-state context and placement are read together. Subjects must be unique by entityType and entityId."
  },
  "ProjectReportPreviewRequestDto": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "scope",
      "exclusions"
    ],
    "properties": {
      "scope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "projectId",
          "windowStart",
          "windowEnd",
          "timeZone"
        ],
        "properties": {
          "projectId": {
            "type": "string",
            "format": "uuid"
          },
          "windowStart": {
            "type": "string",
            "format": "date-time"
          },
          "windowEnd": {
            "type": "string",
            "format": "date-time"
          },
          "timeZone": {
            "type": "string",
            "minLength": 1
          },
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "activityTypes": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "VIEWED",
                "UNBLOCKED",
                "NOTIFICATION",
                "AGENT_SESSION_COMPLETED"
              ],
              "description": "Correlated activity category.\n- VIEWED: User focused or viewed an entity.\n- UNBLOCKED: Work progressed because a dependency or blocking condition was resolved.\n- NOTIFICATION: User-visible system or workflow notification tied to entity activity.\n- AGENT_SESSION_COMPLETED: A linked agent session reached COMPLETED status.\n"
            },
            "uniqueItems": true
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "ATTENTION_EVENT",
                "AGENT_SESSION",
                "TASK_RELATIONSHIP",
                "REPORT",
                "SYSTEM"
              ],
              "description": "Source stream that produced the correlated activity item."
            },
            "uniqueItems": true
          },
          "includeAttentionEvents": {
            "type": "boolean",
            "default": false
          }
        },
        "description": "Fixed UTC start-inclusive/end-exclusive window; start must precede end. timeZone is the display IANA timezone. Omitted actor/classification filters include all authorized matching evidence; empty classification arrays select none. Retains canonical queryActivity semantics."
      },
      "exclusions": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "entityType",
            "entityId"
          ],
          "properties": {
            "entityType": {
              "type": "string",
              "enum": [
                "ARTIFACT",
                "INITIATIVE",
                "PROJECT",
                "TASK",
                "MESSAGE",
                "CONVERSATION",
                "DESIGN_DOC",
                "AGENT_SESSION",
                "VALIDATION_SESSION",
                "SERVICE",
                "REPORT",
                "PROPOSAL",
                "IMPLEMENTATION_HINT",
                "USER"
              ],
              "description": "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry."
            },
            "entityId": {
              "type": "string",
              "format": "uuid"
            }
          }
        },
        "uniqueItems": true
      },
      "search": {
        "type": "string",
        "maxLength": 500
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 200,
        "default": 50
      },
      "offset": {
        "type": "integer",
        "minimum": 0
      }
    },
    "description": "Search changes displayed rows only, not evidence inclusion or population counts. Scope changes require clearing exclusions."
  },
  "RetryProjectReportRequestDto": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "idempotencyKey",
      "expectedAttemptId"
    ],
    "properties": {
      "idempotencyKey": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "expectedAttemptId": {
        "type": "string",
        "format": "uuid"
      }
    },
    "description": "Retry a failed attempt with the original submission and launch configuration. Repeated retry keys return the same attempt; stale expectedAttemptId is a conflict."
  }
} as const;
