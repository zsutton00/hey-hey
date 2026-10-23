/* eslint-disable @typescript-eslint/no-unused-vars */
// Generated from OpenAPI by scripts/generate-proposal-reconciliation-schema.js.
export const proposalReconciliationCandidateSchema = {
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "method"
      ],
      "properties": {
        "method": {
          "type": "string",
          "enum": [
            "MERGE"
          ]
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "method",
        "proposedResult",
        "expectedCurrentBases"
      ],
      "properties": {
        "method": {
          "type": "string",
          "enum": [
            "AGENT_FIX"
          ]
        },
        "proposedResult": {
          "type": "object",
          "additionalProperties": true,
          "description": "Required for Agent fix; admitted through ordinary proposal validation before persistence. Submission never authorizes application."
        },
        "expectedCurrentBases": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "entityType",
              "entityId",
              "version",
              "content"
            ],
            "properties": {
              "entityType": {
                "type": "string",
                "enum": [
                  "TASK",
                  "DESIGN_DOC",
                  "REPORT",
                  "SERVICE",
                  "AGENT_SESSION",
                  "CONVERSATION",
                  "WORK_ITEM_TYPE",
                  "ENTITY_PROMPT_TEMPLATE",
                  "EDGE"
                ]
              },
              "entityId": {
                "type": "string"
              },
              "version": {
                "type": "string",
                "description": "Server-owned version of the exact captured content, including section edits."
              },
              "content": {
                "type": "object",
                "additionalProperties": true,
                "description": "Complete canonical content produced by the owning entity adapter; never a client-supplied historical baseline."
              }
            }
          },
          "description": "The server-issued current bases used to prepare an Agent fix; further drift rejects submission."
        }
      }
    }
  ]
} as const;
export const proposalReconciliationStateSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "status",
    "currentBases",
    "revisions",
    "conflictingPaths",
    "interveningProposals",
    "overlaps"
  ],
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "NOT_APPLICABLE",
        "CURRENT",
        "RECONCILIATION_REQUIRED",
        "AGENT_FIX_REQUIRED",
        "READY_FOR_REVIEW"
      ]
    },
    "writtenAt": {
      "type": "string",
      "format": "date-time",
      "description": "When the change under review was originally written; for a merged replacement, when the proposal it reconciles was written."
    },
    "interveningProposals": {
      "type": "array",
      "description": "Proposals approved on the same target after this change was written, oldest first. Empty when the proposal is approved or rejected.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "proposalId",
          "title",
          "approvedById",
          "approvedByName",
          "approvedAt",
          "changedPaths",
          "overlappingPaths",
          "changes"
        ],
        "properties": {
          "proposalId": {
            "type": "string",
            "format": "uuid"
          },
          "title": {
            "type": "string"
          },
          "approvedById": {
            "type": "string",
            "nullable": true
          },
          "approvedByName": {
            "type": "string",
            "nullable": true
          },
          "approvedAt": {
            "type": "string",
            "format": "date-time"
          },
          "changedPaths": {
            "type": "array",
            "description": "Fields this intervening proposal changed, e.g. `name` or `sections.description`.",
            "items": {
              "type": "string"
            }
          },
          "overlappingPaths": {
            "type": "array",
            "description": "Fields of `changedPaths` that overlap this proposal and could not be merged.",
            "items": {
              "type": "string"
            }
          },
          "changes": {
            "type": "array",
            "description": "The intervening proposal's own change per field, from the content it was reviewed against to the result it applied. Empty when that record is unavailable.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "path"
              ],
              "properties": {
                "path": {
                  "type": "string"
                },
                "before": {},
                "after": {}
              }
            }
          }
        }
      }
    },
    "overlaps": {
      "type": "array",
      "description": "Fields an intervening change and this proposal both changed in ways that cannot be combined automatically. Approval stays unavailable until they are resolved.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "path",
          "interveningProposalId"
        ],
        "properties": {
          "path": {
            "type": "string"
          },
          "proposedValue": {
            "description": "This proposal's value for the field."
          },
          "currentValue": {
            "description": "The field's current value after intervening changes."
          },
          "interveningProposalId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          }
        }
      }
    },
    "currentBases": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "entityType",
          "entityId",
          "version",
          "content"
        ],
        "properties": {
          "entityType": {
            "type": "string",
            "enum": [
              "TASK",
              "DESIGN_DOC",
              "REPORT",
              "SERVICE",
              "AGENT_SESSION",
              "CONVERSATION",
              "WORK_ITEM_TYPE",
              "ENTITY_PROMPT_TEMPLATE",
              "EDGE"
            ]
          },
          "entityId": {
            "type": "string"
          },
          "version": {
            "type": "string",
            "description": "Server-owned version of the exact captured content, including section edits."
          },
          "content": {
            "type": "object",
            "additionalProperties": true,
            "description": "Complete canonical content produced by the owning entity adapter; never a client-supplied historical baseline."
          }
        }
      }
    },
    "revisions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "proposalId",
          "source",
          "bases",
          "proposedResult",
          "intent",
          "createdAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "proposalId": {
            "type": "string",
            "format": "uuid"
          },
          "source": {
            "type": "string",
            "enum": [
              "AUTHORING",
              "MERGE",
              "AGENT_FIX"
            ]
          },
          "previousRevisionId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "bases": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "entityType",
                "entityId",
                "version",
                "content"
              ],
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "TASK",
                    "DESIGN_DOC",
                    "REPORT",
                    "SERVICE",
                    "AGENT_SESSION",
                    "CONVERSATION",
                    "WORK_ITEM_TYPE",
                    "ENTITY_PROMPT_TEMPLATE",
                    "EDGE"
                  ]
                },
                "entityId": {
                  "type": "string"
                },
                "version": {
                  "type": "string",
                  "description": "Server-owned version of the exact captured content, including section edits."
                },
                "content": {
                  "type": "object",
                  "additionalProperties": true,
                  "description": "Complete canonical content produced by the owning entity adapter; never a client-supplied historical baseline."
                }
              }
            }
          },
          "proposedResult": {
            "type": "object",
            "additionalProperties": true,
            "description": "Complete canonical projected content. Graph change sets are keyed by target identity. Omitted patch fields are preserved from the exact authoring basis."
          },
          "intent": {
            "type": "string",
            "nullable": true,
            "description": "Exact authored explanation or title; null when neither was supplied."
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "conflictingPaths": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "candidateRevisionId": {
      "type": "string",
      "format": "uuid"
    },
    "replacementGroupId": {
      "type": "string",
      "format": "uuid"
    },
    "replacementProposalId": {
      "type": "string",
      "format": "uuid"
    }
  }
} as const;
