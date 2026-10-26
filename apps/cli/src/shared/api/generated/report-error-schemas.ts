// Generated from OpenAPI by scripts/generate-report-error-schemas.cjs. Do not edit.
export const reportErrorSchemas = {
  "LocalRunToolCallsLatestTurnRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "machineId"
    ],
    "properties": {
      "machineId": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "LocalRunToolCallsLatestTurnRunId": {
    "type": "string",
    "format": "uuid"
  },
  "LocalWalkthroughSourceRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "machineId",
      "excerpt"
    ],
    "properties": {
      "machineId": {
        "type": "string",
        "format": "uuid"
      },
      "excerpt": {
        "type": "object",
        "required": [
          "serviceId",
          "file",
          "startLine",
          "endLine",
          "language",
          "code",
          "sourceVersion",
          "verification"
        ],
        "properties": {
          "serviceId": {
            "type": "string",
            "format": "uuid"
          },
          "file": {
            "type": "string",
            "minLength": 1,
            "description": "Normalized repository-relative POSIX path with no absolute, dot, parent, empty or backslash segments. Invalid references are retained as UNRESOLVED."
          },
          "startLine": {
            "type": "integer",
            "minimum": 1
          },
          "endLine": {
            "type": "integer",
            "minimum": 1,
            "description": "Inclusive end, at least startLine. Invalid ranges are UNRESOLVED."
          },
          "language": {
            "type": "string"
          },
          "code": {
            "type": "string",
            "description": "Exact literal lines joined with newline, excluding the final line separator."
          },
          "sourceVersion": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "WORKSPACE"
                    ]
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind",
                  "revision"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "GIT"
                    ]
                  },
                  "revision": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{40}([0-9a-f]{24})?$",
                    "description": "Immutable full Git commit object ID."
                  }
                }
              }
            ]
          },
          "verification": {
            "description": "Host-computed evidence at submission time. Revalidate before opening current source.",
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "status",
                  "checkedAt"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "enum": [
                      "VERIFIED"
                    ]
                  },
                  "checkedAt": {
                    "type": "string",
                    "format": "date-time"
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "status",
                  "reason"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "enum": [
                      "UNRESOLVED"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1
                  }
                }
              }
            ]
          }
        }
      }
    }
  },
  "ChangeWalkthroughReportPayload": {
    "description": "Guided behavioral changes in importance order with inspected literal excerpts and immediate explanations. Required Review output, not a repair-authority gate.",
    "allOf": [
      {
        "type": "object",
        "description": "Common base shape every ReportPayload variant inherits via `allOf`. Defines the `summary` field that every report carries: a 50-100 word phase handoff capturing what the next agent needs to know to pick up — not a transcript of what happened this turn. Variants compose this base with their own type-specific shape and contribute their own discriminator + required fields; the `summary` requirement flows in from this base.\n",
        "required": [
          "summary"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "minLength": 1,
            "description": "50-100 word phase handoff. Captures what the next agent needs to know to pick up — outcomes, decisions, and live constraints — not a turn-by-turn transcript of what happened this run.\n"
          }
        }
      }
    ],
    "type": "object",
    "required": [
      "reportType",
      "summary",
      "targetRunId",
      "groups"
    ],
    "properties": {
      "reportType": {
        "type": "string",
        "enum": [
          "CHANGE_WALKTHROUGH"
        ]
      },
      "summary": {
        "type": "string"
      },
      "targetRunId": {
        "type": "string",
        "format": "uuid",
        "description": "Host-stamped reviewed Run identity whose resolved Service workspaces supply source authority."
      },
      "groups": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "title",
            "changes"
          ],
          "properties": {
            "title": {
              "type": "string"
            },
            "changes": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "title",
                  "context",
                  "walkthrough",
                  "behavioralConsequence"
                ],
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "context": {
                    "type": "string"
                  },
                  "walkthrough": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "excerpt",
                        "explanation"
                      ],
                      "properties": {
                        "excerpt": {
                          "type": "object",
                          "required": [
                            "serviceId",
                            "file",
                            "startLine",
                            "endLine",
                            "language",
                            "code",
                            "sourceVersion",
                            "verification"
                          ],
                          "properties": {
                            "serviceId": {
                              "type": "string",
                              "format": "uuid"
                            },
                            "file": {
                              "type": "string",
                              "minLength": 1,
                              "description": "Normalized repository-relative POSIX path with no absolute, dot, parent, empty or backslash segments. Invalid references are retained as UNRESOLVED."
                            },
                            "startLine": {
                              "type": "integer",
                              "minimum": 1
                            },
                            "endLine": {
                              "type": "integer",
                              "minimum": 1,
                              "description": "Inclusive end, at least startLine. Invalid ranges are UNRESOLVED."
                            },
                            "language": {
                              "type": "string"
                            },
                            "code": {
                              "type": "string",
                              "description": "Exact literal lines joined with newline, excluding the final line separator."
                            },
                            "sourceVersion": {
                              "oneOf": [
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "kind"
                                  ],
                                  "properties": {
                                    "kind": {
                                      "type": "string",
                                      "enum": [
                                        "WORKSPACE"
                                      ]
                                    }
                                  }
                                },
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "kind",
                                    "revision"
                                  ],
                                  "properties": {
                                    "kind": {
                                      "type": "string",
                                      "enum": [
                                        "GIT"
                                      ]
                                    },
                                    "revision": {
                                      "type": "string",
                                      "pattern": "^[0-9a-f]{40}([0-9a-f]{24})?$",
                                      "description": "Immutable full Git commit object ID."
                                    }
                                  }
                                }
                              ]
                            },
                            "verification": {
                              "description": "Host-computed evidence at submission time. Revalidate before opening current source.",
                              "oneOf": [
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "status",
                                    "checkedAt"
                                  ],
                                  "properties": {
                                    "status": {
                                      "type": "string",
                                      "enum": [
                                        "VERIFIED"
                                      ]
                                    },
                                    "checkedAt": {
                                      "type": "string",
                                      "format": "date-time"
                                    }
                                  }
                                },
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "status",
                                    "reason"
                                  ],
                                  "properties": {
                                    "status": {
                                      "type": "string",
                                      "enum": [
                                        "UNRESOLVED"
                                      ]
                                    },
                                    "reason": {
                                      "type": "string",
                                      "minLength": 1
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        },
                        "explanation": {
                          "type": "string"
                        }
                      }
                    }
                  },
                  "behavioralConsequence": {
                    "type": "string"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "ActiveGoalDto": {
    "type": "object",
    "description": "A goal returned by the active-goals endpoint: a GOAL-typed task that is not done (status not in COMPLETED/CANCELLED/ARCHIVED), not archived, and is undated or whose dueDate falls inside the requested look-ahead window. Carries just enough for a dashboard or sidebar surface to render the goal without a follow-up lookup.\n",
    "required": [
      "id",
      "name",
      "dueDate",
      "audience"
    ],
    "additionalProperties": false,
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid",
        "description": "Goal task ID."
      },
      "name": {
        "type": "string",
        "description": "Goal task name."
      },
      "dueDate": {
        "type": "string",
        "format": "date-time",
        "nullable": true,
        "description": "When the goal is due (ISO 8601), or null for an undated Goal."
      },
      "audience": {
        "type": "string",
        "description": "Who a goal is targeted at. PROJECT is emitted when no goal_memberships rows exist for the goal — every project member sees it. MEMBERS is emitted as soon as one or more goal_memberships rows exist; the goal is then scoped to that subset rather than the whole project. PERSONAL is reserved for future per-user rollup work and is not yet emitted.\n",
        "enum": [
          "PROJECT",
          "MEMBERS"
        ]
      }
    }
  },
  "ApiErrorResponse": {
    "type": "object",
    "required": [
      "success",
      "message",
      "timestamp",
      "statusCode"
    ],
    "properties": {
      "success": {
        "type": "boolean",
        "description": "Indicates if the request was successful",
        "example": false
      },
      "message": {
        "type": "string",
        "description": "Error message",
        "example": "Resource not found"
      },
      "data": {
        "description": "No data for error responses"
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "description": "ISO timestamp of when the response was generated",
        "example": "2023-12-01T12:00:00.000Z"
      },
      "statusCode": {
        "type": "integer",
        "description": "HTTP status code",
        "example": 404
      },
      "path": {
        "type": "string",
        "description": "Request path",
        "example": "/api/v1/projects/123"
      }
    }
  },
  "CreateReportCompletedAttemptError": {
    "allOf": [
      {
        "type": "object",
        "required": [
          "success",
          "message",
          "timestamp",
          "statusCode"
        ],
        "properties": {
          "success": {
            "type": "boolean",
            "description": "Indicates if the request was successful",
            "example": false
          },
          "message": {
            "type": "string",
            "description": "Error message",
            "example": "Resource not found"
          },
          "data": {
            "description": "No data for error responses"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO timestamp of when the response was generated",
            "example": "2023-12-01T12:00:00.000Z"
          },
          "statusCode": {
            "type": "integer",
            "description": "HTTP status code",
            "example": 404
          },
          "path": {
            "type": "string",
            "description": "Request path",
            "example": "/api/v1/projects/123"
          }
        }
      },
      {
        "type": "object",
        "required": [
          "code",
          "data"
        ],
        "properties": {
          "code": {
            "type": "string",
            "enum": [
              "PROJECT_REPORT_ATTEMPT_COMPLETED"
            ]
          },
          "data": {
            "type": "object",
            "required": [
              "code",
              "requestId",
              "attemptId",
              "reportId"
            ],
            "properties": {
              "code": {
                "type": "string",
                "enum": [
                  "PROJECT_REPORT_ATTEMPT_COMPLETED"
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
              "reportId": {
                "type": "string",
                "format": "uuid"
              }
            }
          }
        }
      }
    ]
  }
} as const;
