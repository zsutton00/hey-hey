/* eslint-disable @typescript-eslint/no-unused-vars */
// Generated from OpenAPI. Do not edit.
export const futureRevisionMutationSchema = {
  "description": "VERSIONED_UPDATE payload for TASK or DESIGN_DOC. Ordinary approval stores or cancels a non-live future. Refinements reference the same futureId; pending or rejected proposals leave its approved content, baseline, dependencies, and approval intact. Ordinary refinement approval accepts the result without an additional acceptance step. Live-target edges and tracks are not accepted on this action; declare completion dependencies in this payload. Baseline and result must match the proposal target and scope. A FUTURE baseline names an existing reviewed parent revision with identical content.",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operation",
        "futureId",
        "expectedRevision",
        "baseline",
        "result",
        "dependencies"
      ],
      "description": "A REVISE result preserves baseline.content.status for both target types; TASK results also preserve baseline.content.config and baseline.content.source because Apply does not write those fields.",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "REVISE"
          ]
        },
        "futureId": {
          "type": "string",
          "format": "uuid",
          "description": "Stable caller-reserved future identity retained by subsequent proposals."
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0,
          "description": "Zero creates a future; refinements name the current reviewed revision."
        },
        "baseline": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "revision",
            "content"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "LIVE",
                "FUTURE"
              ]
            },
            "revision": {
              "type": "string",
              "minLength": 1,
              "description": "Exact source revision token; for FUTURE, the decimal reviewed revision number."
            },
            "futureId": {
              "type": "string",
              "format": "uuid",
              "description": "Required only for FUTURE; identifies one selected parent."
            },
            "content": {
              "description": "Complete selected entity projection including all unchanged sections and, for graph-capable work items, the complete generic graph projection. Never a patch or an overlay of independent futures.",
              "oneOf": [
                {
                  "allOf": [
                    {
                      "type": "object",
                      "required": [
                        "name",
                        "id",
                        "type",
                        "status",
                        "source",
                        "organizationId",
                        "projectId"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid",
                          "description": "The unique identifier for the task."
                        },
                        "name": {
                          "type": "string",
                          "description": "The name or title of the task."
                        },
                        "type": {
                          "type": "string",
                          "description": "Work-item type key. Values are registry-backed and may include system keys such as `STANDARD`, `BUG`, `FEATURE`, `GOAL`, `PLAN`, `PLAN_STAGE`, `CONTRACT`, `DIAGRAM`, `DIAGRAM_ELEMENT`, and `TASK_MONITOR`, or project-defined keys created at runtime.\n",
                          "example": "STANDARD"
                        },
                        "config": {
                          "anyOf": [
                            {
                              "allOf": [
                                {
                                  "oneOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "kind",
                                        "version"
                                      ],
                                      "properties": {
                                        "kind": {
                                          "description": "Discriminator for the launch-configuration semantics.",
                                          "type": "string",
                                          "enum": [
                                            "INITIAL_WORKTREE"
                                          ]
                                        },
                                        "version": {
                                          "type": "string",
                                          "enum": [
                                            "v1"
                                          ],
                                          "description": "Schema-version literal for this launch-configuration kind. A future\nrequired-field change must mint a new version rather than changing v1.\n"
                                        },
                                        "initialWorktreeBranch": {
                                          "anyOf": [
                                            {
                                              "type": "string",
                                              "minLength": 1,
                                              "description": "Optional branch default for coding-session setup. Null or omission\nmeans no stored branch choice; creating the work item never creates a\ncheckout or materializes a worktree.\n"
                                            },
                                            {
                                              "type": "null"
                                            }
                                          ]
                                        }
                                      },
                                      "description": "First version of the generic work-item launch configuration envelope."
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "kind",
                                    "mapping": {
                                      "INITIAL_WORKTREE": "#/WorkItemConfigV1"
                                    }
                                  },
                                  "description": "Discriminated union of typed, versioned launch configuration envelopes.\nThe kind selects the configuration semantics and version evolves the\nshape within that kind.\n"
                                }
                              ],
                              "description": "Typed launch defaults retained with the work item. Null or omission\nmeans no stored launch default; checkout materialization happens only\nwhen a coding session is started.\n"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "sections": {
                          "type": "array",
                          "items": {
                            "allOf": [
                              {
                                "type": "object",
                                "required": [
                                  "key",
                                  "order"
                                ],
                                "properties": {
                                  "id": {
                                    "type": "string",
                                    "description": "The section's unique id"
                                  },
                                  "key": {
                                    "type": "string",
                                    "description": "Unique identifier for the section (e.g., description, details)."
                                  },
                                  "order": {
                                    "type": "integer",
                                    "description": "Ordering index for rendering sections."
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "required": [
                                  "materializedMarkdown",
                                  "materializedProposalId",
                                  "id"
                                ],
                                "properties": {
                                  "materializedMarkdown": {
                                    "type": "string",
                                    "description": "Persisted markdown snapshot for the section."
                                  },
                                  "materializedProposalId": {
                                    "type": "string",
                                    "pattern": "^(?:[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?$",
                                    "description": "Proposal whose successfully materialized change produced the section's current composition or resolved presentation context. Empty when the section has no recorded proposal provenance.\n"
                                  },
                                  "crdtSnapshotSeq": {
                                    "anyOf": [
                                      {
                                        "type": "integer",
                                        "description": "Sequence number associated with the persisted CRDT snapshot."
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          }
                        },
                        "organizationId": {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the organization this task belongs to."
                        },
                        "projectId": {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the project this task belongs to."
                        },
                        "initiativeId": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "uuid",
                              "description": "The ID of the initiative this task is part of."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "status": {
                          "type": "string",
                          "enum": [
                            "GENERATED",
                            "BACKLOG",
                            "READY",
                            "REFINING",
                            "BLOCKED",
                            "REFINING_DESCRIPTION",
                            "REFINING_DETAILS",
                            "REFINING_ACCEPTANCE_CRITERIA",
                            "GENERATING_DESCRIPTION",
                            "GENERATING_DETAILS",
                            "GENERATING_DESCRIPTION_AND_DETAILS",
                            "GENERATING_ACCEPTANCE_CRITERIA",
                            "GENERATING_ALL",
                            "ACTIVE",
                            "ON_HOLD",
                            "VERIFYING",
                            "COMPLETED",
                            "CANCELLED",
                            "ARCHIVED",
                            "SUPERSEDED"
                          ],
                          "description": "Unified work status for initiatives and tasks"
                        },
                        "source": {
                          "type": "string",
                          "enum": [
                            "system",
                            "user",
                            "agent"
                          ],
                          "description": "Origin source for task creation.",
                          "example": "system"
                        },
                        "priority": {
                          "type": "string",
                          "enum": [
                            "LOW",
                            "MEDIUM",
                            "HIGH",
                            "CRITICAL"
                          ],
                          "description": "The priority level of an item.",
                          "example": "HIGH"
                        },
                        "dueDate": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "date-time",
                              "description": "The target completion date, or null for an undated task."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "tag": {
                          "description": "Feature classification. Set on FEATURE tasks; absent on STANDARD,\nBUG, and GOAL tasks.\n",
                          "type": "string",
                          "enum": [
                            "product",
                            "frontend",
                            "backend",
                            "infra",
                            "design",
                            "AI"
                          ],
                          "example": "backend"
                        },
                        "assigneeId": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "uuid",
                              "description": "The ID of the user assigned to this task."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "reporterId": {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the user who reported or created this task."
                        },
                        "parentTaskId": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "uuid",
                              "description": "The ID of the parent task, if this is a sub-task."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "childCounts": {
                          "type": "object",
                          "description": "Aggregated sub-task counts grouped by status for direct children.",
                          "properties": {
                            "total": {
                              "type": "integer",
                              "format": "int32",
                              "description": "Total number of direct child tasks.",
                              "example": 3
                            },
                            "done": {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of direct child tasks marked as done.",
                              "example": 1
                            },
                            "inProgress": {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of direct child tasks currently in progress.",
                              "example": 1
                            },
                            "backlog": {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of direct child tasks that are still in the backlog.",
                              "example": 1
                            }
                          }
                        },
                        "designDocCount": {
                          "anyOf": [
                            {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of design docs linked to this task. Present when includeDesignDocCounts=true; otherwise null."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "codingSessionCount": {
                          "anyOf": [
                            {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of coding sessions (type=CODING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "agentSessionCount": {
                          "anyOf": [
                            {
                              "type": "integer",
                              "format": "int32",
                              "description": "Number of non-coding agent sessions (e.g. DAILY_SESSION, TASK_REFINING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "serviceRelations": {
                          "type": "array",
                          "description": "Service-to-task relation records linked to this task. Present when includeServiceRelations=true.",
                          "items": {
                            "type": "object",
                            "required": [
                              "id",
                              "serviceId",
                              "taskId",
                              "createdAt"
                            ],
                            "properties": {
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "serviceId": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "taskId": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "relationType": {
                                "type": "string",
                                "description": "Type of relationship"
                              },
                              "createdAt": {
                                "type": "string",
                                "format": "date-time"
                              }
                            }
                          }
                        },
                        "edges": {
                          "type": "array",
                          "description": "Agent-authored graph edges that touch this task (inbound + outbound,\ndeduplicated by edge id). Present when includeEdges=true on the\nrequest; otherwise omitted. When `edgeTypes` is omitted, the response\nuses the default generic edge label set; when `edgeTypes` is provided,\nthe requested AgentEdgeType labels define the returned edge domain.\nEdges can include workflow labels (`STANDARD`, `CONDITIONAL`, `LOOP`,\n`FULFILLED_BY`) and preserve graph relationship metadata such as\ncategory, direction, and predicate.\n",
                          "items": {
                            "type": "object",
                            "required": [
                              "id",
                              "sourceNodeId",
                              "targetNodeId",
                              "type",
                              "reasoning",
                              "createdAt",
                              "updatedAt"
                            ],
                            "example": {
                              "id": "8d2f4b1a-1c3e-4f5a-9b6d-7e8c9a0b1c2d",
                              "sourceNodeId": "11111111-1111-1111-1111-111111111111",
                              "sourceNodeName": "Source task",
                              "targetNodeId": "22222222-2222-2222-2222-222222222222",
                              "targetNodeName": "Target task",
                              "type": "PROPOSED_TOGETHER",
                              "source": "system",
                              "reasoning": "Co-authored siblings: both entities were created by the same approved proposal.\n",
                              "createdBySessionId": null,
                              "lastModifiedBySessionId": null,
                              "createdAt": "2026-06-05T12:00:00Z",
                              "updatedAt": "2026-06-05T12:00:00Z"
                            },
                            "properties": {
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "sourceNodeId": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "sourceEntityType": {
                                "description": "Canonical entity type for the source endpoint, as persisted by the Graph service for validation and reconnect operations.\n",
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
                                  "IMPLEMENTATION_HINT"
                                ]
                              },
                              "sourceNodeName": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "description": "Display name for the source endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "targetNodeId": {
                                "type": "string",
                                "format": "uuid"
                              },
                              "targetEntityType": {
                                "description": "Canonical entity type for the target endpoint, as persisted by the Graph service for validation and reconnect operations.\n",
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
                                  "IMPLEMENTATION_HINT"
                                ]
                              },
                              "targetNodeName": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "description": "Display name for the target endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "targetNodeType": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "description": "Work-item subtype materialized on the target endpoint, such as `CONTRACT`; omitted when the endpoint is not a work item or has not been materialized.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "type": {
                                "type": "string",
                                "enum": [
                                  "RELATED_TO",
                                  "DEPENDS_ON",
                                  "DERIVES_FROM",
                                  "SUPERSEDES",
                                  "CONTRADICTS",
                                  "EVOLVES",
                                  "TRACKS",
                                  "PROPOSED_TOGETHER",
                                  "FULFILLED_BY",
                                  "GUARANTEES",
                                  "IMPLEMENTS",
                                  "CONSUMES",
                                  "STANDARD",
                                  "CONDITIONAL",
                                  "LOOP"
                                ],
                                "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                              },
                              "category": {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "meta",
                                      "flow"
                                    ],
                                    "default": "meta",
                                    "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                                  }
                                ],
                                "description": "Edge category used by readers to distinguish generic meta edges from workflow flow structure. Missing values from legacy records are interpreted as `meta`.\n",
                                "default": "meta"
                              },
                              "direction": {
                                "anyOf": [
                                  {
                                    "allOf": [
                                      {
                                        "type": "string",
                                        "enum": [
                                          "forward",
                                          "backward"
                                        ],
                                        "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                      }
                                    ],
                                    "description": "Required for `STANDARD` and `CONDITIONAL` flow edges; omitted for `LOOP` and meta edges.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "predicate": {
                                "anyOf": [
                                  {
                                    "allOf": [
                                      {
                                        "type": "string",
                                        "minLength": 1,
                                        "maxLength": 200,
                                        "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                                        "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                                      }
                                    ],
                                    "description": "Predicate expression or branch label required for `CONDITIONAL` flow edges and optional for `LOOP` flow edges. Omitted for `STANDARD` and meta edges.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "actionLabel": {
                                "anyOf": [
                                  {
                                    "allOf": [
                                      {
                                        "type": "string",
                                        "minLength": 1,
                                        "maxLength": 200,
                                        "pattern": ".*\\S.*",
                                        "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                                      }
                                    ],
                                    "description": "Optional plain-language user action that triggers this flow transition. UX_FLOW Diagrams require it to be non-blank on each flow link.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "reasoning": {
                                "type": "string"
                              },
                              "source": {
                                "description": "Origin of the edge. Defaults to `agent` for edges authored through the agent edge-proposal surface; `system` for edges produced by platform code, including those materialized by the Graph service from a domain event (e.g. PROPOSED_TOGETHER edges derived from proposal approval). Absent on responses from older deployments that predate this field — callers should treat the missing value as `agent`.\n",
                                "example": "agent",
                                "type": "string",
                                "enum": [
                                  "system",
                                  "agent",
                                  "user"
                                ]
                              },
                              "createdBySessionId": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "format": "uuid"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "lastModifiedBySessionId": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "format": "uuid"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true,
                                    "description": "Label-specific relationship metadata declared by the edge contract."
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "createdAt": {
                                "type": "string",
                                "format": "date-time"
                              },
                              "updatedAt": {
                                "type": "string",
                                "format": "date-time"
                              }
                            }
                          }
                        },
                        "createdAt": {
                          "type": "string",
                          "format": "date-time",
                          "readOnly": true,
                          "description": "The timestamp when the task was created."
                        },
                        "updatedAt": {
                          "type": "string",
                          "format": "date-time",
                          "readOnly": true,
                          "description": "The timestamp when the task was last updated."
                        },
                        "hasProposalSupport": {
                          "type": "boolean",
                          "default": true,
                          "description": "Whether this entity type supports MCP proposal tools (e.g. edit_task). Always true for tasks."
                        },
                        "archivedAt": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "date-time",
                              "readOnly": true,
                              "description": "The timestamp when the task was archived (soft delete)."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "trackedEntities": {
                          "type": "array",
                          "description": "Outgoing `TRACKS` edges from this task, inlined as snapshots so list\nviews render tracked items without a second hop. Populated only for\nGOAL-typed tasks (other task types omit the field or return an empty\narray). Order is unspecified; callers should not rely on it.\n",
                          "items": {
                            "type": "object",
                            "description": "Inlined snapshot of an entity referenced by a `TRACKS` edge. Carries the\nfields needed to render the goal's tracked items in a list view without a\nsecond hop. `targetEntityId`, `targetEntityType`, and `title` are always\npresent. `status` and `dueDate` are optional and may be null for target\ntypes that do not carry them (for example PLAN). Wider than EntityNameDto,\nwhich only carries an entity name.\n",
                            "required": [
                              "targetEntityId",
                              "targetEntityType",
                              "title"
                            ],
                            "properties": {
                              "targetEntityId": {
                                "type": "string",
                                "format": "uuid",
                                "description": "ID of the tracked entity."
                              },
                              "targetEntityType": {
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
                              "title": {
                                "type": "string",
                                "description": "Display title for the tracked entity."
                              },
                              "status": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "GENERATED",
                                      "BACKLOG",
                                      "READY",
                                      "REFINING",
                                      "BLOCKED",
                                      "REFINING_DESCRIPTION",
                                      "REFINING_DETAILS",
                                      "REFINING_ACCEPTANCE_CRITERIA",
                                      "GENERATING_DESCRIPTION",
                                      "GENERATING_DETAILS",
                                      "GENERATING_DESCRIPTION_AND_DETAILS",
                                      "GENERATING_ACCEPTANCE_CRITERIA",
                                      "GENERATING_ALL",
                                      "ACTIVE",
                                      "ON_HOLD",
                                      "VERIFYING",
                                      "COMPLETED",
                                      "CANCELLED",
                                      "ARCHIVED",
                                      "SUPERSEDED"
                                    ],
                                    "description": "Unified work status for initiatives and tasks"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "dueDate": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "format": "date-time",
                                    "description": "Target completion date, when the target type carries one."
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          }
                        },
                        "trackedWorkSummary": {
                          "description": "Compact tracked-work aggregate for GOAL tasks. Populated only when the\nlist read requests `includeTrackedWorkSummary=true`, independently of\n`includeTrackedEntities`. Absent on non-GOAL tasks.\n",
                          "type": "object",
                          "required": [
                            "totalCount",
                            "completedCount",
                            "cancelledCount",
                            "pastDueCount",
                            "openUndatedCount"
                          ],
                          "properties": {
                            "totalCount": {
                              "type": "integer",
                              "minimum": 0,
                              "description": "Number of resolved tracked targets."
                            },
                            "completedCount": {
                              "type": "integer",
                              "minimum": 0,
                              "description": "Number of tracked targets in COMPLETED status."
                            },
                            "cancelledCount": {
                              "type": "integer",
                              "minimum": 0,
                              "description": "Number of tracked targets in CANCELLED status."
                            },
                            "pastDueCount": {
                              "type": "integer",
                              "minimum": 0,
                              "description": "Number of open tracked targets whose own due date is before the server's current time."
                            },
                            "openUndatedCount": {
                              "type": "integer",
                              "minimum": 0,
                              "description": "Number of open tracked targets without their own due date. Callers apply the Goal's dueDate to these when deriving progress."
                            }
                          }
                        }
                      },
                      "description": "A task within an organization. Polymorphic over TaskType; the same shape\nrepresents STANDARD, BUG, FEATURE, GOAL, DIAGRAM, DIAGRAM_ELEMENT, and TASK_MONITOR work\nitems. GOAL tasks are top-level by definition (parentTaskId is always null)\nand may have no target date.\nGOAL tasks additionally carry `trackedEntities` — outgoing TRACKS-edge\nsnapshots for the work the goal is tracking. Non-GOAL tasks omit the\nfield or return an empty array.\nWhen requested, GOAL tasks also carry `trackedWorkSummary`, a compact\ncount aggregate that is independent of the `trackedEntities` projection. FEATURE tasks carry `tag`\n(FeatureTag) classifying the feature; the field is absent on all\nnon-FEATURE work-item types.\n"
                    },
                    {
                      "type": "object",
                      "required": [
                        "sections"
                      ],
                      "properties": {
                        "graph": {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "valid",
                            "projectedRoot",
                            "children",
                            "sections",
                            "incidentRelationships",
                            "identityLabels",
                            "issues",
                            "warnings"
                          ],
                          "properties": {
                            "valid": {
                              "type": "boolean"
                            },
                            "projectedRoot": {
                              "anyOf": [
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "identity",
                                    "label",
                                    "type",
                                    "name",
                                    "sections",
                                    "deleted"
                                  ],
                                  "properties": {
                                    "identity": {
                                      "oneOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "refType",
                                            "id"
                                          ],
                                          "properties": {
                                            "refType": {
                                              "type": "string",
                                              "enum": [
                                                "existing"
                                              ]
                                            },
                                            "id": {
                                              "type": "string",
                                              "format": "uuid"
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "refType",
                                            "tempId"
                                          ],
                                          "properties": {
                                            "refType": {
                                              "type": "string",
                                              "enum": [
                                                "temporary"
                                              ]
                                            },
                                            "tempId": {
                                              "type": "string",
                                              "minLength": 1,
                                              "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                            }
                                          }
                                        }
                                      ],
                                      "discriminator": {
                                        "propertyName": "refType",
                                        "mapping": {
                                          "existing": "#/ExistingWorkItemIdentity",
                                          "temporary": "#/TemporaryWorkItemIdentity"
                                        }
                                      },
                                      "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                    },
                                    "label": {
                                      "type": "string"
                                    },
                                    "type": {
                                      "type": "string",
                                      "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                                      "example": "STANDARD"
                                    },
                                    "name": {
                                      "type": "string"
                                    },
                                    "parent": {
                                      "anyOf": [
                                        {
                                          "oneOf": [
                                            {
                                              "type": "object",
                                              "additionalProperties": false,
                                              "required": [
                                                "refType",
                                                "id"
                                              ],
                                              "properties": {
                                                "refType": {
                                                  "type": "string",
                                                  "enum": [
                                                    "existing"
                                                  ]
                                                },
                                                "id": {
                                                  "type": "string",
                                                  "format": "uuid"
                                                }
                                              }
                                            },
                                            {
                                              "type": "object",
                                              "additionalProperties": false,
                                              "required": [
                                                "refType",
                                                "tempId"
                                              ],
                                              "properties": {
                                                "refType": {
                                                  "type": "string",
                                                  "enum": [
                                                    "temporary"
                                                  ]
                                                },
                                                "tempId": {
                                                  "type": "string",
                                                  "minLength": 1,
                                                  "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                                }
                                              }
                                            }
                                          ],
                                          "discriminator": {
                                            "propertyName": "refType",
                                            "mapping": {
                                              "existing": "#/ExistingWorkItemIdentity",
                                              "temporary": "#/TemporaryWorkItemIdentity"
                                            }
                                          },
                                          "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "status": {
                                      "type": "string",
                                      "enum": [
                                        "GENERATED",
                                        "BACKLOG",
                                        "READY",
                                        "REFINING",
                                        "BLOCKED",
                                        "REFINING_DESCRIPTION",
                                        "REFINING_DETAILS",
                                        "REFINING_ACCEPTANCE_CRITERIA",
                                        "GENERATING_DESCRIPTION",
                                        "GENERATING_DETAILS",
                                        "GENERATING_DESCRIPTION_AND_DETAILS",
                                        "GENERATING_ACCEPTANCE_CRITERIA",
                                        "GENERATING_ALL",
                                        "ACTIVE",
                                        "ON_HOLD",
                                        "VERIFYING",
                                        "COMPLETED",
                                        "CANCELLED",
                                        "ARCHIVED",
                                        "SUPERSEDED"
                                      ],
                                      "description": "Unified work status for initiatives and tasks"
                                    },
                                    "priority": {
                                      "type": "string",
                                      "enum": [
                                        "LOW",
                                        "MEDIUM",
                                        "HIGH",
                                        "CRITICAL"
                                      ],
                                      "description": "The priority level of an item.",
                                      "example": "HIGH"
                                    },
                                    "dueDate": {
                                      "anyOf": [
                                        {
                                          "type": "string",
                                          "format": "date-time"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "assigneeId": {
                                      "anyOf": [
                                        {
                                          "type": "string",
                                          "format": "uuid"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    },
                                    "tag": {
                                      "type": "string",
                                      "enum": [
                                        "product",
                                        "frontend",
                                        "backend",
                                        "infra",
                                        "design",
                                        "AI"
                                      ],
                                      "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                                      "example": "backend"
                                    },
                                    "serviceIds": {
                                      "type": "array",
                                      "uniqueItems": true,
                                      "items": {
                                        "type": "string",
                                        "format": "branded-ServiceId",
                                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                        "description": "Unique identifier for a service (branded type)",
                                        "example": "550e8400-e29b-41d4-a716-446655440015",
                                        "x-typescript-type": "ServiceId",
                                        "x-brand": "ServiceId",
                                        "x-semantic-type": "resource-identifier"
                                      }
                                    },
                                    "sections": {
                                      "type": "array",
                                      "items": {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "key",
                                          "content"
                                        ],
                                        "properties": {
                                          "key": {
                                            "type": "string"
                                          },
                                          "content": {
                                            "anyOf": [
                                              {
                                                "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                              },
                                              {
                                                "type": "null"
                                              }
                                            ]
                                          }
                                        }
                                      }
                                    },
                                    "deleted": {
                                      "type": "boolean"
                                    }
                                  }
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            "children": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "identity",
                                  "label",
                                  "type",
                                  "name",
                                  "sections",
                                  "deleted"
                                ],
                                "properties": {
                                  "identity": {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingWorkItemIdentity",
                                        "temporary": "#/TemporaryWorkItemIdentity"
                                      }
                                    },
                                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                  },
                                  "label": {
                                    "type": "string"
                                  },
                                  "type": {
                                    "type": "string",
                                    "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                                    "example": "STANDARD"
                                  },
                                  "name": {
                                    "type": "string"
                                  },
                                  "parent": {
                                    "anyOf": [
                                      {
                                        "oneOf": [
                                          {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": [
                                              "refType",
                                              "id"
                                            ],
                                            "properties": {
                                              "refType": {
                                                "type": "string",
                                                "enum": [
                                                  "existing"
                                                ]
                                              },
                                              "id": {
                                                "type": "string",
                                                "format": "uuid"
                                              }
                                            }
                                          },
                                          {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": [
                                              "refType",
                                              "tempId"
                                            ],
                                            "properties": {
                                              "refType": {
                                                "type": "string",
                                                "enum": [
                                                  "temporary"
                                                ]
                                              },
                                              "tempId": {
                                                "type": "string",
                                                "minLength": 1,
                                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                              }
                                            }
                                          }
                                        ],
                                        "discriminator": {
                                          "propertyName": "refType",
                                          "mapping": {
                                            "existing": "#/ExistingWorkItemIdentity",
                                            "temporary": "#/TemporaryWorkItemIdentity"
                                          }
                                        },
                                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "status": {
                                    "type": "string",
                                    "enum": [
                                      "GENERATED",
                                      "BACKLOG",
                                      "READY",
                                      "REFINING",
                                      "BLOCKED",
                                      "REFINING_DESCRIPTION",
                                      "REFINING_DETAILS",
                                      "REFINING_ACCEPTANCE_CRITERIA",
                                      "GENERATING_DESCRIPTION",
                                      "GENERATING_DETAILS",
                                      "GENERATING_DESCRIPTION_AND_DETAILS",
                                      "GENERATING_ACCEPTANCE_CRITERIA",
                                      "GENERATING_ALL",
                                      "ACTIVE",
                                      "ON_HOLD",
                                      "VERIFYING",
                                      "COMPLETED",
                                      "CANCELLED",
                                      "ARCHIVED",
                                      "SUPERSEDED"
                                    ],
                                    "description": "Unified work status for initiatives and tasks"
                                  },
                                  "priority": {
                                    "type": "string",
                                    "enum": [
                                      "LOW",
                                      "MEDIUM",
                                      "HIGH",
                                      "CRITICAL"
                                    ],
                                    "description": "The priority level of an item.",
                                    "example": "HIGH"
                                  },
                                  "dueDate": {
                                    "anyOf": [
                                      {
                                        "type": "string",
                                        "format": "date-time"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "assigneeId": {
                                    "anyOf": [
                                      {
                                        "type": "string",
                                        "format": "uuid"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "tag": {
                                    "type": "string",
                                    "enum": [
                                      "product",
                                      "frontend",
                                      "backend",
                                      "infra",
                                      "design",
                                      "AI"
                                    ],
                                    "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                                    "example": "backend"
                                  },
                                  "serviceIds": {
                                    "type": "array",
                                    "uniqueItems": true,
                                    "items": {
                                      "type": "string",
                                      "format": "branded-ServiceId",
                                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                      "description": "Unique identifier for a service (branded type)",
                                      "example": "550e8400-e29b-41d4-a716-446655440015",
                                      "x-typescript-type": "ServiceId",
                                      "x-brand": "ServiceId",
                                      "x-semantic-type": "resource-identifier"
                                    }
                                  },
                                  "sections": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "key",
                                        "content"
                                      ],
                                      "properties": {
                                        "key": {
                                          "type": "string"
                                        },
                                        "content": {
                                          "anyOf": [
                                            {
                                              "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                            },
                                            {
                                              "type": "null"
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  },
                                  "deleted": {
                                    "type": "boolean"
                                  }
                                }
                              }
                            },
                            "sections": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "key",
                                  "content"
                                ],
                                "properties": {
                                  "key": {
                                    "type": "string"
                                  },
                                  "content": {
                                    "anyOf": [
                                      {
                                        "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  }
                                }
                              }
                            },
                            "incidentRelationships": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "identity",
                                  "label",
                                  "source",
                                  "target",
                                  "edgeType",
                                  "deleted"
                                ],
                                "properties": {
                                  "identity": {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingRelationshipIdentity",
                                        "temporary": "#/TemporaryRelationshipIdentity"
                                      }
                                    }
                                  },
                                  "label": {
                                    "type": "string"
                                  },
                                  "source": {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingWorkItemIdentity",
                                        "temporary": "#/TemporaryWorkItemIdentity"
                                      }
                                    },
                                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                  },
                                  "sourceEntityType": {
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
                                      "IMPLEMENTATION_HINT"
                                    ],
                                    "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                                  },
                                  "target": {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingWorkItemIdentity",
                                        "temporary": "#/TemporaryWorkItemIdentity"
                                      }
                                    },
                                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                  },
                                  "targetEntityType": {
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
                                      "IMPLEMENTATION_HINT"
                                    ],
                                    "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                                  },
                                  "edgeType": {
                                    "type": "string",
                                    "enum": [
                                      "RELATED_TO",
                                      "DEPENDS_ON",
                                      "DERIVES_FROM",
                                      "SUPERSEDES",
                                      "CONTRADICTS",
                                      "EVOLVES",
                                      "TRACKS",
                                      "PROPOSED_TOGETHER",
                                      "FULFILLED_BY",
                                      "GUARANTEES",
                                      "IMPLEMENTS",
                                      "CONSUMES",
                                      "STANDARD",
                                      "CONDITIONAL",
                                      "LOOP"
                                    ],
                                    "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                                  },
                                  "category": {
                                    "type": "string",
                                    "enum": [
                                      "meta",
                                      "flow"
                                    ],
                                    "default": "meta",
                                    "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                                  },
                                  "direction": {
                                    "anyOf": [
                                      {
                                        "type": "string",
                                        "enum": [
                                          "forward",
                                          "backward"
                                        ],
                                        "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "predicate": {
                                    "anyOf": [
                                      {
                                        "type": "string"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "actionLabel": {
                                    "anyOf": [
                                      {
                                        "allOf": [
                                          {
                                            "type": "string",
                                            "minLength": 1,
                                            "maxLength": 200,
                                            "pattern": ".*\\S.*",
                                            "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                                          }
                                        ]
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "reasoning": {
                                    "anyOf": [
                                      {
                                        "type": "string"
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "metadata": {
                                    "anyOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": true
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  },
                                  "deleted": {
                                    "type": "boolean"
                                  }
                                }
                              }
                            },
                            "identityLabels": {
                              "type": "object",
                              "additionalProperties": {
                                "type": "string"
                              }
                            },
                            "issues": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "field",
                                  "code",
                                  "reason",
                                  "layer"
                                ],
                                "properties": {
                                  "field": {
                                    "type": "string"
                                  },
                                  "code": {
                                    "type": "string"
                                  },
                                  "reason": {
                                    "type": "string"
                                  },
                                  "layer": {
                                    "type": "string",
                                    "enum": [
                                      "structural",
                                      "referential",
                                      "permission"
                                    ]
                                  },
                                  "suggestion": {
                                    "type": "string"
                                  },
                                  "metadata": {
                                    "type": "object",
                                    "additionalProperties": true,
                                    "description": "Machine-readable identities and counts that locate the projected topology involved in this finding. Identity values use the same existing:/temporary: labels as the projected change-set response."
                                  }
                                }
                              }
                            },
                            "warnings": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "field",
                                  "code",
                                  "reason",
                                  "layer"
                                ],
                                "properties": {
                                  "field": {
                                    "type": "string"
                                  },
                                  "code": {
                                    "type": "string"
                                  },
                                  "reason": {
                                    "type": "string"
                                  },
                                  "layer": {
                                    "type": "string",
                                    "enum": [
                                      "structural",
                                      "referential",
                                      "permission"
                                    ]
                                  },
                                  "suggestion": {
                                    "type": "string"
                                  },
                                  "metadata": {
                                    "type": "object",
                                    "additionalProperties": true,
                                    "description": "Machine-readable identities and counts that locate the projected topology involved in this finding. Identity values use the same existing:/temporary: labels as the projected change-set response."
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                },
                {
                  "allOf": [
                    {
                      "type": "object",
                      "required": [
                        "id",
                        "name",
                        "template",
                        "status",
                        "organizationId",
                        "tags",
                        "createdAt",
                        "updatedAt"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid",
                          "description": "Unique identifier for the design document."
                        },
                        "name": {
                          "type": "string",
                          "description": "Human readable title for the design document."
                        },
                        "template": {
                          "type": "string",
                          "description": "Template used to structure the design document.",
                          "enum": [
                            "CLASSIC",
                            "ADR",
                            "RFC",
                            "BRAINSTORM",
                            "DECISION",
                            "PLAN_DOCUMENT"
                          ],
                          "example": "CLASSIC"
                        },
                        "status": {
                          "type": "string",
                          "description": "Current workflow status (template-specific).",
                          "example": "DRAFT_CONCEPT"
                        },
                        "organizationId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "projectId": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "uuid"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "parentEntityId": {
                          "anyOf": [
                            {
                              "type": "string",
                              "format": "uuid",
                              "description": "Identifier of the entity that owns this design document, when set."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "parentEntityType": {
                          "anyOf": [
                            {
                              "allOf": [
                                {
                                  "type": "string",
                                  "description": "Entity type that owns a design document as its parent.",
                                  "enum": [
                                    "TASK",
                                    "DESIGN_DOC"
                                  ],
                                  "example": "TASK"
                                }
                              ],
                              "description": "Type of the parent entity. Set together with parentEntityId."
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "tags": {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        },
                        "createdAt": {
                          "type": "string",
                          "format": "date-time"
                        },
                        "updatedAt": {
                          "type": "string",
                          "format": "date-time"
                        },
                        "sections": {
                          "type": "array",
                          "items": {
                            "allOf": [
                              {
                                "type": "object",
                                "required": [
                                  "key",
                                  "order"
                                ],
                                "properties": {
                                  "id": {
                                    "type": "string",
                                    "description": "The section's unique id"
                                  },
                                  "key": {
                                    "type": "string",
                                    "description": "Unique identifier for the section (e.g., context, decision)."
                                  },
                                  "order": {
                                    "type": "integer",
                                    "description": "Ordering index for rendering sections."
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "required": [
                                  "materializedMarkdown",
                                  "id"
                                ],
                                "properties": {
                                  "materializedMarkdown": {
                                    "type": "string",
                                    "description": "Persisted markdown snapshot for the section."
                                  },
                                  "crdtSnapshotSeq": {
                                    "anyOf": [
                                      {
                                        "type": "integer",
                                        "description": "Sequence number associated with the persisted CRDT snapshot."
                                      },
                                      {
                                        "type": "null"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          }
                        },
                        "summary": {
                          "type": "string"
                        }
                      }
                    },
                    {
                      "type": "object",
                      "required": [
                        "sections"
                      ]
                    }
                  ]
                }
              ]
            }
          }
        },
        "graphChangeSet": {
          "description": "Server-built generic operations from the captured graph baseline to the complete result, including prior reviewed refinements. Used for complete review and the existing materializer on explicit Apply.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "root",
            "operations"
          ],
          "properties": {
            "root": {
              "oneOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "refType",
                    "id"
                  ],
                  "properties": {
                    "refType": {
                      "type": "string",
                      "enum": [
                        "existing"
                      ]
                    },
                    "id": {
                      "type": "string",
                      "format": "uuid"
                    }
                  }
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "refType",
                    "tempId"
                  ],
                  "properties": {
                    "refType": {
                      "type": "string",
                      "enum": [
                        "temporary"
                      ]
                    },
                    "tempId": {
                      "type": "string",
                      "minLength": 1,
                      "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                    }
                  }
                }
              ],
              "discriminator": {
                "propertyName": "refType",
                "mapping": {
                  "existing": "#/ExistingWorkItemIdentity",
                  "temporary": "#/TemporaryWorkItemIdentity"
                }
              },
              "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
            },
            "operations": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref",
                      "name"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "workItem.create"
                        ]
                      },
                      "ref": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      },
                      "name": {
                        "type": "string",
                        "minLength": 1
                      },
                      "type": {
                        "type": "string",
                        "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                        "example": "STANDARD"
                      },
                      "parent": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "GENERATED",
                          "BACKLOG",
                          "READY",
                          "REFINING",
                          "BLOCKED",
                          "REFINING_DESCRIPTION",
                          "REFINING_DETAILS",
                          "REFINING_ACCEPTANCE_CRITERIA",
                          "GENERATING_DESCRIPTION",
                          "GENERATING_DETAILS",
                          "GENERATING_DESCRIPTION_AND_DETAILS",
                          "GENERATING_ACCEPTANCE_CRITERIA",
                          "GENERATING_ALL",
                          "ACTIVE",
                          "ON_HOLD",
                          "VERIFYING",
                          "COMPLETED",
                          "CANCELLED",
                          "ARCHIVED",
                          "SUPERSEDED"
                        ],
                        "description": "Unified work status for initiatives and tasks"
                      },
                      "priority": {
                        "type": "string",
                        "enum": [
                          "LOW",
                          "MEDIUM",
                          "HIGH",
                          "CRITICAL"
                        ],
                        "description": "The priority level of an item.",
                        "example": "HIGH"
                      },
                      "dueDate": {
                        "anyOf": [
                          {
                            "type": "string",
                            "format": "date-time"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "assigneeId": {
                        "anyOf": [
                          {
                            "type": "string",
                            "format": "uuid"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "tag": {
                        "type": "string",
                        "enum": [
                          "product",
                          "frontend",
                          "backend",
                          "infra",
                          "design",
                          "AI"
                        ],
                        "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                        "example": "backend"
                      },
                      "serviceIds": {
                        "type": "array",
                        "description": "Optional complete known Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                        "items": {
                          "type": "string",
                          "format": "branded-ServiceId",
                          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          "description": "Unique identifier for a service (branded type)",
                          "example": "550e8400-e29b-41d4-a716-446655440015",
                          "x-typescript-type": "ServiceId",
                          "x-brand": "ServiceId",
                          "x-semantic-type": "resource-identifier"
                        }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "workItem.update"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "name": {
                        "type": "string",
                        "minLength": 1
                      },
                      "parent": {
                        "anyOf": [
                          {
                            "allOf": [
                              {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              }
                            ]
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "GENERATED",
                          "BACKLOG",
                          "READY",
                          "REFINING",
                          "BLOCKED",
                          "REFINING_DESCRIPTION",
                          "REFINING_DETAILS",
                          "REFINING_ACCEPTANCE_CRITERIA",
                          "GENERATING_DESCRIPTION",
                          "GENERATING_DETAILS",
                          "GENERATING_DESCRIPTION_AND_DETAILS",
                          "GENERATING_ACCEPTANCE_CRITERIA",
                          "GENERATING_ALL",
                          "ACTIVE",
                          "ON_HOLD",
                          "VERIFYING",
                          "COMPLETED",
                          "CANCELLED",
                          "ARCHIVED",
                          "SUPERSEDED"
                        ],
                        "description": "Unified work status for initiatives and tasks"
                      },
                      "priority": {
                        "type": "string",
                        "enum": [
                          "LOW",
                          "MEDIUM",
                          "HIGH",
                          "CRITICAL"
                        ],
                        "description": "The priority level of an item.",
                        "example": "HIGH"
                      },
                      "dueDate": {
                        "anyOf": [
                          {
                            "type": "string",
                            "format": "date-time"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "assigneeId": {
                        "anyOf": [
                          {
                            "type": "string",
                            "format": "uuid"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "tag": {
                        "type": "string",
                        "enum": [
                          "product",
                          "frontend",
                          "backend",
                          "infra",
                          "design",
                          "AI"
                        ],
                        "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                        "example": "backend"
                      },
                      "serviceIds": {
                        "type": "array",
                        "description": "Optional complete known replacement Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                        "items": {
                          "type": "string",
                          "format": "branded-ServiceId",
                          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          "description": "Unique identifier for a service (branded type)",
                          "example": "550e8400-e29b-41d4-a716-446655440015",
                          "x-typescript-type": "ServiceId",
                          "x-brand": "ServiceId",
                          "x-semantic-type": "resource-identifier"
                        }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "workItem.delete"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref",
                      "key",
                      "content"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "section.replace"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "key": {
                        "type": "string",
                        "minLength": 1
                      },
                      "content": {
                        "anyOf": [
                          {
                            "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref",
                      "key"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "section.clear"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "key": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "source",
                          "target",
                          "edgeType"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.create"
                            ]
                          },
                          "ref": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          },
                          "source": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "target": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "edgeType": {
                            "type": "string",
                            "enum": [
                              "RELATED_TO",
                              "DEPENDS_ON",
                              "DERIVES_FROM",
                              "SUPERSEDES",
                              "CONTRADICTS",
                              "EVOLVES",
                              "TRACKS",
                              "PROPOSED_TOGETHER",
                              "FULFILLED_BY",
                              "GUARANTEES",
                              "IMPLEMENTS",
                              "CONSUMES"
                            ],
                            "description": "Agent-authored relationship types in the meta category. GUARANTEES, IMPLEMENTS and CONSUMES connect TASK DIAGRAM_ELEMENT sources to TASK CONTRACT targets."
                          },
                          "category": {
                            "type": "string",
                            "enum": [
                              "meta"
                            ]
                          },
                          "direction": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "forward",
                                      "backward"
                                    ],
                                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                  }
                                ]
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "predicate": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "reasoning": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "source",
                          "target",
                          "edgeType",
                          "category",
                          "direction"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.create"
                            ]
                          },
                          "ref": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          },
                          "source": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "target": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "edgeType": {
                            "type": "string",
                            "enum": [
                              "STANDARD"
                            ]
                          },
                          "category": {
                            "type": "string",
                            "enum": [
                              "flow"
                            ]
                          },
                          "direction": {
                            "type": "string",
                            "enum": [
                              "forward",
                              "backward"
                            ],
                            "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                          },
                          "actionLabel": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": ".*\\S.*",
                            "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                          },
                          "reasoning": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "source",
                          "target",
                          "edgeType",
                          "category",
                          "direction",
                          "predicate"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.create"
                            ]
                          },
                          "ref": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          },
                          "source": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "target": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "edgeType": {
                            "type": "string",
                            "enum": [
                              "CONDITIONAL"
                            ]
                          },
                          "category": {
                            "type": "string",
                            "enum": [
                              "flow"
                            ]
                          },
                          "direction": {
                            "type": "string",
                            "enum": [
                              "forward",
                              "backward"
                            ],
                            "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                          },
                          "predicate": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                            "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                          },
                          "actionLabel": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": ".*\\S.*",
                            "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                          },
                          "reasoning": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "source",
                          "target",
                          "edgeType",
                          "category"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.create"
                            ]
                          },
                          "ref": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          },
                          "source": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "target": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "edgeType": {
                            "type": "string",
                            "enum": [
                              "LOOP"
                            ]
                          },
                          "category": {
                            "type": "string",
                            "enum": [
                              "flow"
                            ]
                          },
                          "predicate": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                            "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                          },
                          "actionLabel": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": ".*\\S.*",
                            "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                          },
                          "reasoning": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "edgeType",
                      "mapping": {
                        "RELATED_TO": "#/WorkItemMetaRelationshipCreateOperation",
                        "DEPENDS_ON": "#/WorkItemMetaRelationshipCreateOperation",
                        "DERIVES_FROM": "#/WorkItemMetaRelationshipCreateOperation",
                        "SUPERSEDES": "#/WorkItemMetaRelationshipCreateOperation",
                        "CONTRADICTS": "#/WorkItemMetaRelationshipCreateOperation",
                        "EVOLVES": "#/WorkItemMetaRelationshipCreateOperation",
                        "TRACKS": "#/WorkItemMetaRelationshipCreateOperation",
                        "PROPOSED_TOGETHER": "#/WorkItemMetaRelationshipCreateOperation",
                        "FULFILLED_BY": "#/WorkItemMetaRelationshipCreateOperation",
                        "GUARANTEES": "#/WorkItemMetaRelationshipCreateOperation",
                        "IMPLEMENTS": "#/WorkItemMetaRelationshipCreateOperation",
                        "CONSUMES": "#/WorkItemMetaRelationshipCreateOperation",
                        "STANDARD": "#/WorkItemStandardRelationshipCreateOperation",
                        "CONDITIONAL": "#/WorkItemConditionalRelationshipCreateOperation",
                        "LOOP": "#/WorkItemLoopRelationshipCreateOperation"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "relationship.update"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingRelationshipIdentity",
                            "temporary": "#/TemporaryRelationshipIdentity"
                          }
                        }
                      },
                      "source": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "sourceEntityType": {
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
                          "IMPLEMENTATION_HINT"
                        ],
                        "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                      },
                      "target": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "targetEntityType": {
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
                          "IMPLEMENTATION_HINT"
                        ],
                        "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                      },
                      "edgeType": {
                        "type": "string",
                        "enum": [
                          "RELATED_TO",
                          "DEPENDS_ON",
                          "DERIVES_FROM",
                          "SUPERSEDES",
                          "CONTRADICTS",
                          "EVOLVES",
                          "TRACKS",
                          "PROPOSED_TOGETHER",
                          "FULFILLED_BY",
                          "GUARANTEES",
                          "IMPLEMENTS",
                          "CONSUMES",
                          "STANDARD",
                          "CONDITIONAL",
                          "LOOP"
                        ],
                        "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                      },
                      "category": {
                        "type": "string",
                        "enum": [
                          "meta",
                          "flow"
                        ],
                        "default": "meta",
                        "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                      },
                      "direction": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "forward",
                              "backward"
                            ],
                            "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "predicate": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "actionLabel": {
                        "anyOf": [
                          {
                            "allOf": [
                              {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": ".*\\S.*",
                                "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                              }
                            ]
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "reasoning": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "metadata": {
                        "anyOf": [
                          {
                            "type": "object",
                            "additionalProperties": true
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "ref"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "relationship.delete"
                        ]
                      },
                      "ref": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingRelationshipIdentity",
                            "temporary": "#/TemporaryRelationshipIdentity"
                          }
                        }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "root",
                      "sectionKey",
                      "entries"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "layout.replace"
                        ]
                      },
                      "root": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "sectionKey": {
                        "type": "string",
                        "minLength": 1
                      },
                      "entries": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "node",
                            "position"
                          ],
                          "properties": {
                            "node": {
                              "oneOf": [
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "refType",
                                    "id"
                                  ],
                                  "properties": {
                                    "refType": {
                                      "type": "string",
                                      "enum": [
                                        "existing"
                                      ]
                                    },
                                    "id": {
                                      "type": "string",
                                      "format": "uuid"
                                    }
                                  }
                                },
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "refType",
                                    "tempId"
                                  ],
                                  "properties": {
                                    "refType": {
                                      "type": "string",
                                      "enum": [
                                        "temporary"
                                      ]
                                    },
                                    "tempId": {
                                      "type": "string",
                                      "minLength": 1,
                                      "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                    }
                                  }
                                }
                              ],
                              "discriminator": {
                                "propertyName": "refType",
                                "mapping": {
                                  "existing": "#/ExistingWorkItemIdentity",
                                  "temporary": "#/TemporaryWorkItemIdentity"
                                }
                              }
                            },
                            "position": {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "x",
                                "y"
                              ],
                              "properties": {
                                "x": {
                                  "type": "number"
                                },
                                "y": {
                                  "type": "number"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "op",
                      "root",
                      "sectionKey"
                    ],
                    "properties": {
                      "op": {
                        "type": "string",
                        "enum": [
                          "layout.clear"
                        ]
                      },
                      "root": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      },
                      "sectionKey": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "op",
                  "mapping": {
                    "workItem.create": "#/WorkItemCreateOperation",
                    "workItem.update": "#/WorkItemUpdateOperation",
                    "workItem.delete": "#/WorkItemDeleteOperation",
                    "section.replace": "#/WorkItemSectionReplaceOperation",
                    "section.clear": "#/WorkItemSectionClearOperation",
                    "relationship.create": "#/WorkItemRelationshipCreateOperation",
                    "relationship.update": "#/WorkItemRelationshipUpdateOperation",
                    "relationship.delete": "#/WorkItemRelationshipDeleteOperation",
                    "layout.replace": "#/WorkItemLayoutReplaceOperation",
                    "layout.clear": "#/WorkItemLayoutClearOperation"
                  }
                }
              }
            },
            "layoutBoundary": {
              "type": "array",
              "description": "Complete set of work-item identities expected in the root graph layout boundary.",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                }
              }
            }
          }
        },
        "result": {
          "description": "Complete selected entity projection including all unchanged sections and, for graph-capable work items, the complete generic graph projection. Never a patch or an overlay of independent futures.",
          "oneOf": [
            {
              "allOf": [
                {
                  "type": "object",
                  "required": [
                    "name",
                    "id",
                    "type",
                    "status",
                    "source",
                    "organizationId",
                    "projectId"
                  ],
                  "properties": {
                    "id": {
                      "type": "string",
                      "format": "uuid",
                      "description": "The unique identifier for the task."
                    },
                    "name": {
                      "type": "string",
                      "description": "The name or title of the task."
                    },
                    "type": {
                      "type": "string",
                      "description": "Work-item type key. Values are registry-backed and may include system keys such as `STANDARD`, `BUG`, `FEATURE`, `GOAL`, `PLAN`, `PLAN_STAGE`, `CONTRACT`, `DIAGRAM`, `DIAGRAM_ELEMENT`, and `TASK_MONITOR`, or project-defined keys created at runtime.\n",
                      "example": "STANDARD"
                    },
                    "config": {
                      "anyOf": [
                        {
                          "allOf": [
                            {
                              "oneOf": [
                                {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "kind",
                                    "version"
                                  ],
                                  "properties": {
                                    "kind": {
                                      "description": "Discriminator for the launch-configuration semantics.",
                                      "type": "string",
                                      "enum": [
                                        "INITIAL_WORKTREE"
                                      ]
                                    },
                                    "version": {
                                      "type": "string",
                                      "enum": [
                                        "v1"
                                      ],
                                      "description": "Schema-version literal for this launch-configuration kind. A future\nrequired-field change must mint a new version rather than changing v1.\n"
                                    },
                                    "initialWorktreeBranch": {
                                      "anyOf": [
                                        {
                                          "type": "string",
                                          "minLength": 1,
                                          "description": "Optional branch default for coding-session setup. Null or omission\nmeans no stored branch choice; creating the work item never creates a\ncheckout or materializes a worktree.\n"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    }
                                  },
                                  "description": "First version of the generic work-item launch configuration envelope."
                                }
                              ],
                              "discriminator": {
                                "propertyName": "kind",
                                "mapping": {
                                  "INITIAL_WORKTREE": "#/WorkItemConfigV1"
                                }
                              },
                              "description": "Discriminated union of typed, versioned launch configuration envelopes.\nThe kind selects the configuration semantics and version evolves the\nshape within that kind.\n"
                            }
                          ],
                          "description": "Typed launch defaults retained with the work item. Null or omission\nmeans no stored launch default; checkout materialization happens only\nwhen a coding session is started.\n"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "sections": {
                      "type": "array",
                      "items": {
                        "allOf": [
                          {
                            "type": "object",
                            "required": [
                              "key",
                              "order"
                            ],
                            "properties": {
                              "id": {
                                "type": "string",
                                "description": "The section's unique id"
                              },
                              "key": {
                                "type": "string",
                                "description": "Unique identifier for the section (e.g., description, details)."
                              },
                              "order": {
                                "type": "integer",
                                "description": "Ordering index for rendering sections."
                              }
                            }
                          },
                          {
                            "type": "object",
                            "required": [
                              "materializedMarkdown",
                              "materializedProposalId",
                              "id"
                            ],
                            "properties": {
                              "materializedMarkdown": {
                                "type": "string",
                                "description": "Persisted markdown snapshot for the section."
                              },
                              "materializedProposalId": {
                                "type": "string",
                                "pattern": "^(?:[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?$",
                                "description": "Proposal whose successfully materialized change produced the section's current composition or resolved presentation context. Empty when the section has no recorded proposal provenance.\n"
                              },
                              "crdtSnapshotSeq": {
                                "anyOf": [
                                  {
                                    "type": "integer",
                                    "description": "Sequence number associated with the persisted CRDT snapshot."
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          }
                        ]
                      }
                    },
                    "organizationId": {
                      "type": "string",
                      "format": "uuid",
                      "description": "The ID of the organization this task belongs to."
                    },
                    "projectId": {
                      "type": "string",
                      "format": "uuid",
                      "description": "The ID of the project this task belongs to."
                    },
                    "initiativeId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the initiative this task is part of."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "GENERATED",
                        "BACKLOG",
                        "READY",
                        "REFINING",
                        "BLOCKED",
                        "REFINING_DESCRIPTION",
                        "REFINING_DETAILS",
                        "REFINING_ACCEPTANCE_CRITERIA",
                        "GENERATING_DESCRIPTION",
                        "GENERATING_DETAILS",
                        "GENERATING_DESCRIPTION_AND_DETAILS",
                        "GENERATING_ACCEPTANCE_CRITERIA",
                        "GENERATING_ALL",
                        "ACTIVE",
                        "ON_HOLD",
                        "VERIFYING",
                        "COMPLETED",
                        "CANCELLED",
                        "ARCHIVED",
                        "SUPERSEDED"
                      ],
                      "description": "Unified work status for initiatives and tasks"
                    },
                    "source": {
                      "type": "string",
                      "enum": [
                        "system",
                        "user",
                        "agent"
                      ],
                      "description": "Origin source for task creation.",
                      "example": "system"
                    },
                    "priority": {
                      "type": "string",
                      "enum": [
                        "LOW",
                        "MEDIUM",
                        "HIGH",
                        "CRITICAL"
                      ],
                      "description": "The priority level of an item.",
                      "example": "HIGH"
                    },
                    "dueDate": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "date-time",
                          "description": "The target completion date, or null for an undated task."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "tag": {
                      "description": "Feature classification. Set on FEATURE tasks; absent on STANDARD,\nBUG, and GOAL tasks.\n",
                      "type": "string",
                      "enum": [
                        "product",
                        "frontend",
                        "backend",
                        "infra",
                        "design",
                        "AI"
                      ],
                      "example": "backend"
                    },
                    "assigneeId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the user assigned to this task."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "reporterId": {
                      "type": "string",
                      "format": "uuid",
                      "description": "The ID of the user who reported or created this task."
                    },
                    "parentTaskId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "uuid",
                          "description": "The ID of the parent task, if this is a sub-task."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "childCounts": {
                      "type": "object",
                      "description": "Aggregated sub-task counts grouped by status for direct children.",
                      "properties": {
                        "total": {
                          "type": "integer",
                          "format": "int32",
                          "description": "Total number of direct child tasks.",
                          "example": 3
                        },
                        "done": {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of direct child tasks marked as done.",
                          "example": 1
                        },
                        "inProgress": {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of direct child tasks currently in progress.",
                          "example": 1
                        },
                        "backlog": {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of direct child tasks that are still in the backlog.",
                          "example": 1
                        }
                      }
                    },
                    "designDocCount": {
                      "anyOf": [
                        {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of design docs linked to this task. Present when includeDesignDocCounts=true; otherwise null."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "codingSessionCount": {
                      "anyOf": [
                        {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of coding sessions (type=CODING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "agentSessionCount": {
                      "anyOf": [
                        {
                          "type": "integer",
                          "format": "int32",
                          "description": "Number of non-coding agent sessions (e.g. DAILY_SESSION, TASK_REFINING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "serviceRelations": {
                      "type": "array",
                      "description": "Service-to-task relation records linked to this task. Present when includeServiceRelations=true.",
                      "items": {
                        "type": "object",
                        "required": [
                          "id",
                          "serviceId",
                          "taskId",
                          "createdAt"
                        ],
                        "properties": {
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "serviceId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "taskId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "relationType": {
                            "type": "string",
                            "description": "Type of relationship"
                          },
                          "createdAt": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "edges": {
                      "type": "array",
                      "description": "Agent-authored graph edges that touch this task (inbound + outbound,\ndeduplicated by edge id). Present when includeEdges=true on the\nrequest; otherwise omitted. When `edgeTypes` is omitted, the response\nuses the default generic edge label set; when `edgeTypes` is provided,\nthe requested AgentEdgeType labels define the returned edge domain.\nEdges can include workflow labels (`STANDARD`, `CONDITIONAL`, `LOOP`,\n`FULFILLED_BY`) and preserve graph relationship metadata such as\ncategory, direction, and predicate.\n",
                      "items": {
                        "type": "object",
                        "required": [
                          "id",
                          "sourceNodeId",
                          "targetNodeId",
                          "type",
                          "reasoning",
                          "createdAt",
                          "updatedAt"
                        ],
                        "example": {
                          "id": "8d2f4b1a-1c3e-4f5a-9b6d-7e8c9a0b1c2d",
                          "sourceNodeId": "11111111-1111-1111-1111-111111111111",
                          "sourceNodeName": "Source task",
                          "targetNodeId": "22222222-2222-2222-2222-222222222222",
                          "targetNodeName": "Target task",
                          "type": "PROPOSED_TOGETHER",
                          "source": "system",
                          "reasoning": "Co-authored siblings: both entities were created by the same approved proposal.\n",
                          "createdBySessionId": null,
                          "lastModifiedBySessionId": null,
                          "createdAt": "2026-06-05T12:00:00Z",
                          "updatedAt": "2026-06-05T12:00:00Z"
                        },
                        "properties": {
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "sourceNodeId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "sourceEntityType": {
                            "description": "Canonical entity type for the source endpoint, as persisted by the Graph service for validation and reconnect operations.\n",
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
                              "IMPLEMENTATION_HINT"
                            ]
                          },
                          "sourceNodeName": {
                            "anyOf": [
                              {
                                "type": "string",
                                "description": "Display name for the source endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "targetNodeId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "targetEntityType": {
                            "description": "Canonical entity type for the target endpoint, as persisted by the Graph service for validation and reconnect operations.\n",
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
                              "IMPLEMENTATION_HINT"
                            ]
                          },
                          "targetNodeName": {
                            "anyOf": [
                              {
                                "type": "string",
                                "description": "Display name for the target endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "targetNodeType": {
                            "anyOf": [
                              {
                                "type": "string",
                                "description": "Work-item subtype materialized on the target endpoint, such as `CONTRACT`; omitted when the endpoint is not a work item or has not been materialized.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "type": {
                            "type": "string",
                            "enum": [
                              "RELATED_TO",
                              "DEPENDS_ON",
                              "DERIVES_FROM",
                              "SUPERSEDES",
                              "CONTRADICTS",
                              "EVOLVES",
                              "TRACKS",
                              "PROPOSED_TOGETHER",
                              "FULFILLED_BY",
                              "GUARANTEES",
                              "IMPLEMENTS",
                              "CONSUMES",
                              "STANDARD",
                              "CONDITIONAL",
                              "LOOP"
                            ],
                            "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                          },
                          "category": {
                            "allOf": [
                              {
                                "type": "string",
                                "enum": [
                                  "meta",
                                  "flow"
                                ],
                                "default": "meta",
                                "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                              }
                            ],
                            "description": "Edge category used by readers to distinguish generic meta edges from workflow flow structure. Missing values from legacy records are interpreted as `meta`.\n",
                            "default": "meta"
                          },
                          "direction": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "forward",
                                      "backward"
                                    ],
                                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                  }
                                ],
                                "description": "Required for `STANDARD` and `CONDITIONAL` flow edges; omitted for `LOOP` and meta edges.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "predicate": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200,
                                    "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                                    "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                                  }
                                ],
                                "description": "Predicate expression or branch label required for `CONDITIONAL` flow edges and optional for `LOOP` flow edges. Omitted for `STANDARD` and meta edges.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "actionLabel": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200,
                                    "pattern": ".*\\S.*",
                                    "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                                  }
                                ],
                                "description": "Optional plain-language user action that triggers this flow transition. UX_FLOW Diagrams require it to be non-blank on each flow link.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "reasoning": {
                            "type": "string"
                          },
                          "source": {
                            "description": "Origin of the edge. Defaults to `agent` for edges authored through the agent edge-proposal surface; `system` for edges produced by platform code, including those materialized by the Graph service from a domain event (e.g. PROPOSED_TOGETHER edges derived from proposal approval). Absent on responses from older deployments that predate this field — callers should treat the missing value as `agent`.\n",
                            "example": "agent",
                            "type": "string",
                            "enum": [
                              "system",
                              "agent",
                              "user"
                            ]
                          },
                          "createdBySessionId": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "uuid"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "lastModifiedBySessionId": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "uuid"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true,
                                "description": "Label-specific relationship metadata declared by the edge contract."
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "createdAt": {
                            "type": "string",
                            "format": "date-time"
                          },
                          "updatedAt": {
                            "type": "string",
                            "format": "date-time"
                          }
                        }
                      }
                    },
                    "createdAt": {
                      "type": "string",
                      "format": "date-time",
                      "readOnly": true,
                      "description": "The timestamp when the task was created."
                    },
                    "updatedAt": {
                      "type": "string",
                      "format": "date-time",
                      "readOnly": true,
                      "description": "The timestamp when the task was last updated."
                    },
                    "hasProposalSupport": {
                      "type": "boolean",
                      "default": true,
                      "description": "Whether this entity type supports MCP proposal tools (e.g. edit_task). Always true for tasks."
                    },
                    "archivedAt": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "date-time",
                          "readOnly": true,
                          "description": "The timestamp when the task was archived (soft delete)."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "trackedEntities": {
                      "type": "array",
                      "description": "Outgoing `TRACKS` edges from this task, inlined as snapshots so list\nviews render tracked items without a second hop. Populated only for\nGOAL-typed tasks (other task types omit the field or return an empty\narray). Order is unspecified; callers should not rely on it.\n",
                      "items": {
                        "type": "object",
                        "description": "Inlined snapshot of an entity referenced by a `TRACKS` edge. Carries the\nfields needed to render the goal's tracked items in a list view without a\nsecond hop. `targetEntityId`, `targetEntityType`, and `title` are always\npresent. `status` and `dueDate` are optional and may be null for target\ntypes that do not carry them (for example PLAN). Wider than EntityNameDto,\nwhich only carries an entity name.\n",
                        "required": [
                          "targetEntityId",
                          "targetEntityType",
                          "title"
                        ],
                        "properties": {
                          "targetEntityId": {
                            "type": "string",
                            "format": "uuid",
                            "description": "ID of the tracked entity."
                          },
                          "targetEntityType": {
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
                          "title": {
                            "type": "string",
                            "description": "Display title for the tracked entity."
                          },
                          "status": {
                            "anyOf": [
                              {
                                "type": "string",
                                "enum": [
                                  "GENERATED",
                                  "BACKLOG",
                                  "READY",
                                  "REFINING",
                                  "BLOCKED",
                                  "REFINING_DESCRIPTION",
                                  "REFINING_DETAILS",
                                  "REFINING_ACCEPTANCE_CRITERIA",
                                  "GENERATING_DESCRIPTION",
                                  "GENERATING_DETAILS",
                                  "GENERATING_DESCRIPTION_AND_DETAILS",
                                  "GENERATING_ACCEPTANCE_CRITERIA",
                                  "GENERATING_ALL",
                                  "ACTIVE",
                                  "ON_HOLD",
                                  "VERIFYING",
                                  "COMPLETED",
                                  "CANCELLED",
                                  "ARCHIVED",
                                  "SUPERSEDED"
                                ],
                                "description": "Unified work status for initiatives and tasks"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "dueDate": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "date-time",
                                "description": "Target completion date, when the target type carries one."
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      }
                    },
                    "trackedWorkSummary": {
                      "description": "Compact tracked-work aggregate for GOAL tasks. Populated only when the\nlist read requests `includeTrackedWorkSummary=true`, independently of\n`includeTrackedEntities`. Absent on non-GOAL tasks.\n",
                      "type": "object",
                      "required": [
                        "totalCount",
                        "completedCount",
                        "cancelledCount",
                        "pastDueCount",
                        "openUndatedCount"
                      ],
                      "properties": {
                        "totalCount": {
                          "type": "integer",
                          "minimum": 0,
                          "description": "Number of resolved tracked targets."
                        },
                        "completedCount": {
                          "type": "integer",
                          "minimum": 0,
                          "description": "Number of tracked targets in COMPLETED status."
                        },
                        "cancelledCount": {
                          "type": "integer",
                          "minimum": 0,
                          "description": "Number of tracked targets in CANCELLED status."
                        },
                        "pastDueCount": {
                          "type": "integer",
                          "minimum": 0,
                          "description": "Number of open tracked targets whose own due date is before the server's current time."
                        },
                        "openUndatedCount": {
                          "type": "integer",
                          "minimum": 0,
                          "description": "Number of open tracked targets without their own due date. Callers apply the Goal's dueDate to these when deriving progress."
                        }
                      }
                    }
                  },
                  "description": "A task within an organization. Polymorphic over TaskType; the same shape\nrepresents STANDARD, BUG, FEATURE, GOAL, DIAGRAM, DIAGRAM_ELEMENT, and TASK_MONITOR work\nitems. GOAL tasks are top-level by definition (parentTaskId is always null)\nand may have no target date.\nGOAL tasks additionally carry `trackedEntities` — outgoing TRACKS-edge\nsnapshots for the work the goal is tracking. Non-GOAL tasks omit the\nfield or return an empty array.\nWhen requested, GOAL tasks also carry `trackedWorkSummary`, a compact\ncount aggregate that is independent of the `trackedEntities` projection. FEATURE tasks carry `tag`\n(FeatureTag) classifying the feature; the field is absent on all\nnon-FEATURE work-item types.\n"
                },
                {
                  "type": "object",
                  "required": [
                    "sections"
                  ],
                  "properties": {
                    "graph": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "valid",
                        "projectedRoot",
                        "children",
                        "sections",
                        "incidentRelationships",
                        "identityLabels",
                        "issues",
                        "warnings"
                      ],
                      "properties": {
                        "valid": {
                          "type": "boolean"
                        },
                        "projectedRoot": {
                          "anyOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "identity",
                                "label",
                                "type",
                                "name",
                                "sections",
                                "deleted"
                              ],
                              "properties": {
                                "identity": {
                                  "oneOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "refType",
                                        "id"
                                      ],
                                      "properties": {
                                        "refType": {
                                          "type": "string",
                                          "enum": [
                                            "existing"
                                          ]
                                        },
                                        "id": {
                                          "type": "string",
                                          "format": "uuid"
                                        }
                                      }
                                    },
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "refType",
                                        "tempId"
                                      ],
                                      "properties": {
                                        "refType": {
                                          "type": "string",
                                          "enum": [
                                            "temporary"
                                          ]
                                        },
                                        "tempId": {
                                          "type": "string",
                                          "minLength": 1,
                                          "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                        }
                                      }
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "refType",
                                    "mapping": {
                                      "existing": "#/ExistingWorkItemIdentity",
                                      "temporary": "#/TemporaryWorkItemIdentity"
                                    }
                                  },
                                  "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                },
                                "label": {
                                  "type": "string"
                                },
                                "type": {
                                  "type": "string",
                                  "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                                  "example": "STANDARD"
                                },
                                "name": {
                                  "type": "string"
                                },
                                "parent": {
                                  "anyOf": [
                                    {
                                      "oneOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "refType",
                                            "id"
                                          ],
                                          "properties": {
                                            "refType": {
                                              "type": "string",
                                              "enum": [
                                                "existing"
                                              ]
                                            },
                                            "id": {
                                              "type": "string",
                                              "format": "uuid"
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "refType",
                                            "tempId"
                                          ],
                                          "properties": {
                                            "refType": {
                                              "type": "string",
                                              "enum": [
                                                "temporary"
                                              ]
                                            },
                                            "tempId": {
                                              "type": "string",
                                              "minLength": 1,
                                              "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                            }
                                          }
                                        }
                                      ],
                                      "discriminator": {
                                        "propertyName": "refType",
                                        "mapping": {
                                          "existing": "#/ExistingWorkItemIdentity",
                                          "temporary": "#/TemporaryWorkItemIdentity"
                                        }
                                      },
                                      "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "status": {
                                  "type": "string",
                                  "enum": [
                                    "GENERATED",
                                    "BACKLOG",
                                    "READY",
                                    "REFINING",
                                    "BLOCKED",
                                    "REFINING_DESCRIPTION",
                                    "REFINING_DETAILS",
                                    "REFINING_ACCEPTANCE_CRITERIA",
                                    "GENERATING_DESCRIPTION",
                                    "GENERATING_DETAILS",
                                    "GENERATING_DESCRIPTION_AND_DETAILS",
                                    "GENERATING_ACCEPTANCE_CRITERIA",
                                    "GENERATING_ALL",
                                    "ACTIVE",
                                    "ON_HOLD",
                                    "VERIFYING",
                                    "COMPLETED",
                                    "CANCELLED",
                                    "ARCHIVED",
                                    "SUPERSEDED"
                                  ],
                                  "description": "Unified work status for initiatives and tasks"
                                },
                                "priority": {
                                  "type": "string",
                                  "enum": [
                                    "LOW",
                                    "MEDIUM",
                                    "HIGH",
                                    "CRITICAL"
                                  ],
                                  "description": "The priority level of an item.",
                                  "example": "HIGH"
                                },
                                "dueDate": {
                                  "anyOf": [
                                    {
                                      "type": "string",
                                      "format": "date-time"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "assigneeId": {
                                  "anyOf": [
                                    {
                                      "type": "string",
                                      "format": "uuid"
                                    },
                                    {
                                      "type": "null"
                                    }
                                  ]
                                },
                                "tag": {
                                  "type": "string",
                                  "enum": [
                                    "product",
                                    "frontend",
                                    "backend",
                                    "infra",
                                    "design",
                                    "AI"
                                  ],
                                  "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                                  "example": "backend"
                                },
                                "serviceIds": {
                                  "type": "array",
                                  "uniqueItems": true,
                                  "items": {
                                    "type": "string",
                                    "format": "branded-ServiceId",
                                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                    "description": "Unique identifier for a service (branded type)",
                                    "example": "550e8400-e29b-41d4-a716-446655440015",
                                    "x-typescript-type": "ServiceId",
                                    "x-brand": "ServiceId",
                                    "x-semantic-type": "resource-identifier"
                                  }
                                },
                                "sections": {
                                  "type": "array",
                                  "items": {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "key",
                                      "content"
                                    ],
                                    "properties": {
                                      "key": {
                                        "type": "string"
                                      },
                                      "content": {
                                        "anyOf": [
                                          {
                                            "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                          },
                                          {
                                            "type": "null"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                },
                                "deleted": {
                                  "type": "boolean"
                                }
                              }
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "children": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "identity",
                              "label",
                              "type",
                              "name",
                              "sections",
                              "deleted"
                            ],
                            "properties": {
                              "identity": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "label": {
                                "type": "string"
                              },
                              "type": {
                                "type": "string",
                                "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                                "example": "STANDARD"
                              },
                              "name": {
                                "type": "string"
                              },
                              "parent": {
                                "anyOf": [
                                  {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingWorkItemIdentity",
                                        "temporary": "#/TemporaryWorkItemIdentity"
                                      }
                                    },
                                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "status": {
                                "type": "string",
                                "enum": [
                                  "GENERATED",
                                  "BACKLOG",
                                  "READY",
                                  "REFINING",
                                  "BLOCKED",
                                  "REFINING_DESCRIPTION",
                                  "REFINING_DETAILS",
                                  "REFINING_ACCEPTANCE_CRITERIA",
                                  "GENERATING_DESCRIPTION",
                                  "GENERATING_DETAILS",
                                  "GENERATING_DESCRIPTION_AND_DETAILS",
                                  "GENERATING_ACCEPTANCE_CRITERIA",
                                  "GENERATING_ALL",
                                  "ACTIVE",
                                  "ON_HOLD",
                                  "VERIFYING",
                                  "COMPLETED",
                                  "CANCELLED",
                                  "ARCHIVED",
                                  "SUPERSEDED"
                                ],
                                "description": "Unified work status for initiatives and tasks"
                              },
                              "priority": {
                                "type": "string",
                                "enum": [
                                  "LOW",
                                  "MEDIUM",
                                  "HIGH",
                                  "CRITICAL"
                                ],
                                "description": "The priority level of an item.",
                                "example": "HIGH"
                              },
                              "dueDate": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "format": "date-time"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "assigneeId": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "format": "uuid"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "tag": {
                                "type": "string",
                                "enum": [
                                  "product",
                                  "frontend",
                                  "backend",
                                  "infra",
                                  "design",
                                  "AI"
                                ],
                                "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                                "example": "backend"
                              },
                              "serviceIds": {
                                "type": "array",
                                "uniqueItems": true,
                                "items": {
                                  "type": "string",
                                  "format": "branded-ServiceId",
                                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                  "description": "Unique identifier for a service (branded type)",
                                  "example": "550e8400-e29b-41d4-a716-446655440015",
                                  "x-typescript-type": "ServiceId",
                                  "x-brand": "ServiceId",
                                  "x-semantic-type": "resource-identifier"
                                }
                              },
                              "sections": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "key",
                                    "content"
                                  ],
                                  "properties": {
                                    "key": {
                                      "type": "string"
                                    },
                                    "content": {
                                      "anyOf": [
                                        {
                                          "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                        },
                                        {
                                          "type": "null"
                                        }
                                      ]
                                    }
                                  }
                                }
                              },
                              "deleted": {
                                "type": "boolean"
                              }
                            }
                          }
                        },
                        "sections": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "key",
                              "content"
                            ],
                            "properties": {
                              "key": {
                                "type": "string"
                              },
                              "content": {
                                "anyOf": [
                                  {
                                    "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          }
                        },
                        "incidentRelationships": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "identity",
                              "label",
                              "source",
                              "target",
                              "edgeType",
                              "deleted"
                            ],
                            "properties": {
                              "identity": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingRelationshipIdentity",
                                    "temporary": "#/TemporaryRelationshipIdentity"
                                  }
                                }
                              },
                              "label": {
                                "type": "string"
                              },
                              "source": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "sourceEntityType": {
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
                                  "IMPLEMENTATION_HINT"
                                ],
                                "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                              },
                              "target": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "targetEntityType": {
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
                                  "IMPLEMENTATION_HINT"
                                ],
                                "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                              },
                              "edgeType": {
                                "type": "string",
                                "enum": [
                                  "RELATED_TO",
                                  "DEPENDS_ON",
                                  "DERIVES_FROM",
                                  "SUPERSEDES",
                                  "CONTRADICTS",
                                  "EVOLVES",
                                  "TRACKS",
                                  "PROPOSED_TOGETHER",
                                  "FULFILLED_BY",
                                  "GUARANTEES",
                                  "IMPLEMENTS",
                                  "CONSUMES",
                                  "STANDARD",
                                  "CONDITIONAL",
                                  "LOOP"
                                ],
                                "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                              },
                              "category": {
                                "type": "string",
                                "enum": [
                                  "meta",
                                  "flow"
                                ],
                                "default": "meta",
                                "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                              },
                              "direction": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "forward",
                                      "backward"
                                    ],
                                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "predicate": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "actionLabel": {
                                "anyOf": [
                                  {
                                    "allOf": [
                                      {
                                        "type": "string",
                                        "minLength": 1,
                                        "maxLength": 200,
                                        "pattern": ".*\\S.*",
                                        "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                                      }
                                    ]
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "reasoning": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "deleted": {
                                "type": "boolean"
                              }
                            }
                          }
                        },
                        "identityLabels": {
                          "type": "object",
                          "additionalProperties": {
                            "type": "string"
                          }
                        },
                        "issues": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "field",
                              "code",
                              "reason",
                              "layer"
                            ],
                            "properties": {
                              "field": {
                                "type": "string"
                              },
                              "code": {
                                "type": "string"
                              },
                              "reason": {
                                "type": "string"
                              },
                              "layer": {
                                "type": "string",
                                "enum": [
                                  "structural",
                                  "referential",
                                  "permission"
                                ]
                              },
                              "suggestion": {
                                "type": "string"
                              },
                              "metadata": {
                                "type": "object",
                                "additionalProperties": true,
                                "description": "Machine-readable identities and counts that locate the projected topology involved in this finding. Identity values use the same existing:/temporary: labels as the projected change-set response."
                              }
                            }
                          }
                        },
                        "warnings": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "field",
                              "code",
                              "reason",
                              "layer"
                            ],
                            "properties": {
                              "field": {
                                "type": "string"
                              },
                              "code": {
                                "type": "string"
                              },
                              "reason": {
                                "type": "string"
                              },
                              "layer": {
                                "type": "string",
                                "enum": [
                                  "structural",
                                  "referential",
                                  "permission"
                                ]
                              },
                              "suggestion": {
                                "type": "string"
                              },
                              "metadata": {
                                "type": "object",
                                "additionalProperties": true,
                                "description": "Machine-readable identities and counts that locate the projected topology involved in this finding. Identity values use the same existing:/temporary: labels as the projected change-set response."
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              ]
            },
            {
              "allOf": [
                {
                  "type": "object",
                  "required": [
                    "id",
                    "name",
                    "template",
                    "status",
                    "organizationId",
                    "tags",
                    "createdAt",
                    "updatedAt"
                  ],
                  "properties": {
                    "id": {
                      "type": "string",
                      "format": "uuid",
                      "description": "Unique identifier for the design document."
                    },
                    "name": {
                      "type": "string",
                      "description": "Human readable title for the design document."
                    },
                    "template": {
                      "type": "string",
                      "description": "Template used to structure the design document.",
                      "enum": [
                        "CLASSIC",
                        "ADR",
                        "RFC",
                        "BRAINSTORM",
                        "DECISION",
                        "PLAN_DOCUMENT"
                      ],
                      "example": "CLASSIC"
                    },
                    "status": {
                      "type": "string",
                      "description": "Current workflow status (template-specific).",
                      "example": "DRAFT_CONCEPT"
                    },
                    "organizationId": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "projectId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "uuid"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "parentEntityId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "format": "uuid",
                          "description": "Identifier of the entity that owns this design document, when set."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "parentEntityType": {
                      "anyOf": [
                        {
                          "allOf": [
                            {
                              "type": "string",
                              "description": "Entity type that owns a design document as its parent.",
                              "enum": [
                                "TASK",
                                "DESIGN_DOC"
                              ],
                              "example": "TASK"
                            }
                          ],
                          "description": "Type of the parent entity. Set together with parentEntityId."
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "createdAt": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "updatedAt": {
                      "type": "string",
                      "format": "date-time"
                    },
                    "sections": {
                      "type": "array",
                      "items": {
                        "allOf": [
                          {
                            "type": "object",
                            "required": [
                              "key",
                              "order"
                            ],
                            "properties": {
                              "id": {
                                "type": "string",
                                "description": "The section's unique id"
                              },
                              "key": {
                                "type": "string",
                                "description": "Unique identifier for the section (e.g., context, decision)."
                              },
                              "order": {
                                "type": "integer",
                                "description": "Ordering index for rendering sections."
                              }
                            }
                          },
                          {
                            "type": "object",
                            "required": [
                              "materializedMarkdown",
                              "id"
                            ],
                            "properties": {
                              "materializedMarkdown": {
                                "type": "string",
                                "description": "Persisted markdown snapshot for the section."
                              },
                              "crdtSnapshotSeq": {
                                "anyOf": [
                                  {
                                    "type": "integer",
                                    "description": "Sequence number associated with the persisted CRDT snapshot."
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          }
                        ]
                      }
                    },
                    "summary": {
                      "type": "string"
                    }
                  }
                },
                {
                  "type": "object",
                  "required": [
                    "sections"
                  ]
                }
              ]
            }
          ]
        },
        "dependencies": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "edgeType",
              "targetEntityType",
              "targetEntityId"
            ],
            "properties": {
              "edgeType": {
                "type": "string",
                "enum": [
                  "DEPENDS_ON"
                ]
              },
              "targetEntityType": {
                "type": "string",
                "enum": [
                  "TASK"
                ],
                "description": "Canonical work-item identity. Eligible types have registry role work-item, or the platform PLAN type explicitly. Completion remains owned by Work Items and Plans."
              },
              "targetEntityId": {
                "type": "string",
                "format": "uuid"
              }
            }
          },
          "description": "Complete reviewed dependency set owned by this future, separate from generic links and group enactment order."
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operation",
        "futureId",
        "expectedRevision"
      ],
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "CANCEL"
          ]
        },
        "futureId": {
          "type": "string",
          "format": "uuid"
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        }
      }
    }
  ]
};
export const futureApplyRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "expectedRevision"
  ],
  "properties": {
    "expectedRevision": {
      "type": "integer",
      "minimum": 1,
      "description": "Approved future revision the user chose to apply."
    },
    "confirmation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "revision",
        "refinements"
      ],
      "description": "Explicit authorization to invalidate exactly these pending refinement versions after successful application of this approved revision. Echo the returned value. This does not waive any application check.",
      "properties": {
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "refinements": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "proposalId",
              "updatedAt"
            ],
            "properties": {
              "proposalId": {
                "type": "string",
                "format": "uuid"
              },
              "updatedAt": {
                "type": "string",
                "format": "date-time"
              }
            }
          }
        }
      }
    }
  }
};
export const futureRevisionAuthoringSchema = {
  "description": "Agent authoring input; refinements build on the future's latest reviewed result so earlier reviewed changes are kept.",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operation",
        "futureId",
        "expectedRevision",
        "changes"
      ],
      "description": "Authored as a delta so agents never reproduce unchanged content; the server stores the complete FutureRevisionUpdate it materializes.",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "REVISE"
          ]
        },
        "futureId": {
          "type": "string",
          "format": "uuid"
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "baseline": {
          "description": "The server reads the selected content so authors never resend it.",
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
                    "LIVE"
                  ]
                }
              }
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind",
                "futureId",
                "revision"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "FUTURE"
                  ]
                },
                "futureId": {
                  "type": "string",
                  "format": "uuid"
                },
                "revision": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            }
          ]
        },
        "changes": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "description": "Same change shape as a live work-item edit. Status, type, config and source stay with the baseline because Apply does not write them.",
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1
                },
                "priority": {
                  "type": "string",
                  "enum": [
                    "LOW",
                    "MEDIUM",
                    "HIGH",
                    "CRITICAL"
                  ],
                  "description": "The priority level of an item.",
                  "example": "HIGH"
                },
                "tag": {
                  "type": "string",
                  "enum": [
                    "product",
                    "frontend",
                    "backend",
                    "infra",
                    "design",
                    "AI"
                  ],
                  "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                  "example": "backend"
                },
                "initiativeId": {
                  "type": "string",
                  "format": "uuid"
                },
                "dueDate": {
                  "anyOf": [
                    {
                      "type": "string",
                      "format": "date-time"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "assigneeId": {
                  "anyOf": [
                    {
                      "type": "string",
                      "format": "uuid"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "parentTaskId": {
                  "anyOf": [
                    {
                      "type": "string",
                      "format": "uuid"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "sections": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "key",
                      "content"
                    ],
                    "properties": {
                      "key": {
                        "type": "string",
                        "description": "Section key from the work-item type definition."
                      },
                      "content": {
                        "anyOf": [
                          {
                            "description": "Section content to initialize or update. Markdown sections use strings; JSON sections use schema-backed values, html/css sections use the strict WorkItemHtmlCssSectionContent object, and structured-mockup sections use WorkItemStructuredMockupSectionContent.\n"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "order": {
                        "type": "integer",
                        "description": "Optional ordering index for rendering sections."
                      }
                    }
                  }
                },
                "operations": {
                  "type": "array",
                  "description": "Generic graph edits within the target root, its children and incident relationships. The root cannot be deleted or change type or status. Applied to the selected non-live graph, including during refinement.",
                  "items": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "name"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "workItem.create"
                            ]
                          },
                          "ref": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          },
                          "name": {
                            "type": "string",
                            "minLength": 1
                          },
                          "type": {
                            "type": "string",
                            "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                            "example": "STANDARD"
                          },
                          "parent": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "GENERATED",
                              "BACKLOG",
                              "READY",
                              "REFINING",
                              "BLOCKED",
                              "REFINING_DESCRIPTION",
                              "REFINING_DETAILS",
                              "REFINING_ACCEPTANCE_CRITERIA",
                              "GENERATING_DESCRIPTION",
                              "GENERATING_DETAILS",
                              "GENERATING_DESCRIPTION_AND_DETAILS",
                              "GENERATING_ACCEPTANCE_CRITERIA",
                              "GENERATING_ALL",
                              "ACTIVE",
                              "ON_HOLD",
                              "VERIFYING",
                              "COMPLETED",
                              "CANCELLED",
                              "ARCHIVED",
                              "SUPERSEDED"
                            ],
                            "description": "Unified work status for initiatives and tasks"
                          },
                          "priority": {
                            "type": "string",
                            "enum": [
                              "LOW",
                              "MEDIUM",
                              "HIGH",
                              "CRITICAL"
                            ],
                            "description": "The priority level of an item.",
                            "example": "HIGH"
                          },
                          "dueDate": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "date-time"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "assigneeId": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "uuid"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "tag": {
                            "type": "string",
                            "enum": [
                              "product",
                              "frontend",
                              "backend",
                              "infra",
                              "design",
                              "AI"
                            ],
                            "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                            "example": "backend"
                          },
                          "serviceIds": {
                            "type": "array",
                            "description": "Optional complete known Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                            "items": {
                              "type": "string",
                              "format": "branded-ServiceId",
                              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              "description": "Unique identifier for a service (branded type)",
                              "example": "550e8400-e29b-41d4-a716-446655440015",
                              "x-typescript-type": "ServiceId",
                              "x-brand": "ServiceId",
                              "x-semantic-type": "resource-identifier"
                            }
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "workItem.update"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "name": {
                            "type": "string",
                            "minLength": 1
                          },
                          "parent": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "oneOf": [
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "id"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "existing"
                                            ]
                                          },
                                          "id": {
                                            "type": "string",
                                            "format": "uuid"
                                          }
                                        }
                                      },
                                      {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": [
                                          "refType",
                                          "tempId"
                                        ],
                                        "properties": {
                                          "refType": {
                                            "type": "string",
                                            "enum": [
                                              "temporary"
                                            ]
                                          },
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                          }
                                        }
                                      }
                                    ],
                                    "discriminator": {
                                      "propertyName": "refType",
                                      "mapping": {
                                        "existing": "#/ExistingWorkItemIdentity",
                                        "temporary": "#/TemporaryWorkItemIdentity"
                                      }
                                    },
                                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                                  }
                                ]
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "GENERATED",
                              "BACKLOG",
                              "READY",
                              "REFINING",
                              "BLOCKED",
                              "REFINING_DESCRIPTION",
                              "REFINING_DETAILS",
                              "REFINING_ACCEPTANCE_CRITERIA",
                              "GENERATING_DESCRIPTION",
                              "GENERATING_DETAILS",
                              "GENERATING_DESCRIPTION_AND_DETAILS",
                              "GENERATING_ACCEPTANCE_CRITERIA",
                              "GENERATING_ALL",
                              "ACTIVE",
                              "ON_HOLD",
                              "VERIFYING",
                              "COMPLETED",
                              "CANCELLED",
                              "ARCHIVED",
                              "SUPERSEDED"
                            ],
                            "description": "Unified work status for initiatives and tasks"
                          },
                          "priority": {
                            "type": "string",
                            "enum": [
                              "LOW",
                              "MEDIUM",
                              "HIGH",
                              "CRITICAL"
                            ],
                            "description": "The priority level of an item.",
                            "example": "HIGH"
                          },
                          "dueDate": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "date-time"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "assigneeId": {
                            "anyOf": [
                              {
                                "type": "string",
                                "format": "uuid"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "tag": {
                            "type": "string",
                            "enum": [
                              "product",
                              "frontend",
                              "backend",
                              "infra",
                              "design",
                              "AI"
                            ],
                            "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                            "example": "backend"
                          },
                          "serviceIds": {
                            "type": "array",
                            "description": "Optional complete known replacement Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                            "items": {
                              "type": "string",
                              "format": "branded-ServiceId",
                              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              "description": "Unique identifier for a service (branded type)",
                              "example": "550e8400-e29b-41d4-a716-446655440015",
                              "x-typescript-type": "ServiceId",
                              "x-brand": "ServiceId",
                              "x-semantic-type": "resource-identifier"
                            }
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "workItem.delete"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "key",
                          "content"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "section.replace"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "key": {
                            "type": "string",
                            "minLength": 1
                          },
                          "content": {
                            "anyOf": [
                              {
                                "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref",
                          "key"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "section.clear"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "key": {
                            "type": "string",
                            "minLength": 1
                          }
                        }
                      },
                      {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "op",
                              "ref",
                              "source",
                              "target",
                              "edgeType"
                            ],
                            "properties": {
                              "op": {
                                "type": "string",
                                "enum": [
                                  "relationship.create"
                                ]
                              },
                              "ref": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              },
                              "source": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "target": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "edgeType": {
                                "type": "string",
                                "enum": [
                                  "RELATED_TO",
                                  "DEPENDS_ON",
                                  "DERIVES_FROM",
                                  "SUPERSEDES",
                                  "CONTRADICTS",
                                  "EVOLVES",
                                  "TRACKS",
                                  "PROPOSED_TOGETHER",
                                  "FULFILLED_BY",
                                  "GUARANTEES",
                                  "IMPLEMENTS",
                                  "CONSUMES"
                                ],
                                "description": "Agent-authored relationship types in the meta category. GUARANTEES, IMPLEMENTS and CONSUMES connect TASK DIAGRAM_ELEMENT sources to TASK CONTRACT targets."
                              },
                              "category": {
                                "type": "string",
                                "enum": [
                                  "meta"
                                ]
                              },
                              "direction": {
                                "anyOf": [
                                  {
                                    "allOf": [
                                      {
                                        "type": "string",
                                        "enum": [
                                          "forward",
                                          "backward"
                                        ],
                                        "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                                      }
                                    ]
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "predicate": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "reasoning": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "op",
                              "ref",
                              "source",
                              "target",
                              "edgeType",
                              "category",
                              "direction"
                            ],
                            "properties": {
                              "op": {
                                "type": "string",
                                "enum": [
                                  "relationship.create"
                                ]
                              },
                              "ref": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              },
                              "source": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "target": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "edgeType": {
                                "type": "string",
                                "enum": [
                                  "STANDARD"
                                ]
                              },
                              "category": {
                                "type": "string",
                                "enum": [
                                  "flow"
                                ]
                              },
                              "direction": {
                                "type": "string",
                                "enum": [
                                  "forward",
                                  "backward"
                                ],
                                "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                              },
                              "actionLabel": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": ".*\\S.*",
                                "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                              },
                              "reasoning": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "op",
                              "ref",
                              "source",
                              "target",
                              "edgeType",
                              "category",
                              "direction",
                              "predicate"
                            ],
                            "properties": {
                              "op": {
                                "type": "string",
                                "enum": [
                                  "relationship.create"
                                ]
                              },
                              "ref": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              },
                              "source": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "target": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "edgeType": {
                                "type": "string",
                                "enum": [
                                  "CONDITIONAL"
                                ]
                              },
                              "category": {
                                "type": "string",
                                "enum": [
                                  "flow"
                                ]
                              },
                              "direction": {
                                "type": "string",
                                "enum": [
                                  "forward",
                                  "backward"
                                ],
                                "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                              },
                              "predicate": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                                "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                              },
                              "actionLabel": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": ".*\\S.*",
                                "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                              },
                              "reasoning": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "op",
                              "ref",
                              "source",
                              "target",
                              "edgeType",
                              "category"
                            ],
                            "properties": {
                              "op": {
                                "type": "string",
                                "enum": [
                                  "relationship.create"
                                ]
                              },
                              "ref": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              },
                              "source": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "target": {
                                "oneOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "id"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "existing"
                                        ]
                                      },
                                      "id": {
                                        "type": "string",
                                        "format": "uuid"
                                      }
                                    }
                                  },
                                  {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                      "refType",
                                      "tempId"
                                    ],
                                    "properties": {
                                      "refType": {
                                        "type": "string",
                                        "enum": [
                                          "temporary"
                                        ]
                                      },
                                      "tempId": {
                                        "type": "string",
                                        "minLength": 1,
                                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                      }
                                    }
                                  }
                                ],
                                "discriminator": {
                                  "propertyName": "refType",
                                  "mapping": {
                                    "existing": "#/ExistingWorkItemIdentity",
                                    "temporary": "#/TemporaryWorkItemIdentity"
                                  }
                                },
                                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                              },
                              "edgeType": {
                                "type": "string",
                                "enum": [
                                  "LOOP"
                                ]
                              },
                              "category": {
                                "type": "string",
                                "enum": [
                                  "flow"
                                ]
                              },
                              "predicate": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                                "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                              },
                              "actionLabel": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200,
                                "pattern": ".*\\S.*",
                                "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                              },
                              "reasoning": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              },
                              "metadata": {
                                "anyOf": [
                                  {
                                    "type": "object",
                                    "additionalProperties": true
                                  },
                                  {
                                    "type": "null"
                                  }
                                ]
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "edgeType",
                          "mapping": {
                            "RELATED_TO": "#/WorkItemMetaRelationshipCreateOperation",
                            "DEPENDS_ON": "#/WorkItemMetaRelationshipCreateOperation",
                            "DERIVES_FROM": "#/WorkItemMetaRelationshipCreateOperation",
                            "SUPERSEDES": "#/WorkItemMetaRelationshipCreateOperation",
                            "CONTRADICTS": "#/WorkItemMetaRelationshipCreateOperation",
                            "EVOLVES": "#/WorkItemMetaRelationshipCreateOperation",
                            "TRACKS": "#/WorkItemMetaRelationshipCreateOperation",
                            "PROPOSED_TOGETHER": "#/WorkItemMetaRelationshipCreateOperation",
                            "FULFILLED_BY": "#/WorkItemMetaRelationshipCreateOperation",
                            "GUARANTEES": "#/WorkItemMetaRelationshipCreateOperation",
                            "IMPLEMENTS": "#/WorkItemMetaRelationshipCreateOperation",
                            "CONSUMES": "#/WorkItemMetaRelationshipCreateOperation",
                            "STANDARD": "#/WorkItemStandardRelationshipCreateOperation",
                            "CONDITIONAL": "#/WorkItemConditionalRelationshipCreateOperation",
                            "LOOP": "#/WorkItemLoopRelationshipCreateOperation"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.update"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingRelationshipIdentity",
                                "temporary": "#/TemporaryRelationshipIdentity"
                              }
                            }
                          },
                          "source": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "sourceEntityType": {
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
                              "IMPLEMENTATION_HINT"
                            ],
                            "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                          },
                          "target": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "targetEntityType": {
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
                              "IMPLEMENTATION_HINT"
                            ],
                            "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
                          },
                          "edgeType": {
                            "type": "string",
                            "enum": [
                              "RELATED_TO",
                              "DEPENDS_ON",
                              "DERIVES_FROM",
                              "SUPERSEDES",
                              "CONTRADICTS",
                              "EVOLVES",
                              "TRACKS",
                              "PROPOSED_TOGETHER",
                              "FULFILLED_BY",
                              "GUARANTEES",
                              "IMPLEMENTS",
                              "CONSUMES",
                              "STANDARD",
                              "CONDITIONAL",
                              "LOOP"
                            ],
                            "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
                          },
                          "category": {
                            "type": "string",
                            "enum": [
                              "meta",
                              "flow"
                            ],
                            "default": "meta",
                            "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
                          },
                          "direction": {
                            "anyOf": [
                              {
                                "type": "string",
                                "enum": [
                                  "forward",
                                  "backward"
                                ],
                                "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "predicate": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "actionLabel": {
                            "anyOf": [
                              {
                                "allOf": [
                                  {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200,
                                    "pattern": ".*\\S.*",
                                    "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                                  }
                                ]
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "reasoning": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "metadata": {
                            "anyOf": [
                              {
                                "type": "object",
                                "additionalProperties": true
                              },
                              {
                                "type": "null"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "ref"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "relationship.delete"
                            ]
                          },
                          "ref": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingRelationshipIdentity",
                                "temporary": "#/TemporaryRelationshipIdentity"
                              }
                            }
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "root",
                          "sectionKey",
                          "entries"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "layout.replace"
                            ]
                          },
                          "root": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "sectionKey": {
                            "type": "string",
                            "minLength": 1
                          },
                          "entries": {
                            "type": "array",
                            "items": {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "node",
                                "position"
                              ],
                              "properties": {
                                "node": {
                                  "oneOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "refType",
                                        "id"
                                      ],
                                      "properties": {
                                        "refType": {
                                          "type": "string",
                                          "enum": [
                                            "existing"
                                          ]
                                        },
                                        "id": {
                                          "type": "string",
                                          "format": "uuid"
                                        }
                                      }
                                    },
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "refType",
                                        "tempId"
                                      ],
                                      "properties": {
                                        "refType": {
                                          "type": "string",
                                          "enum": [
                                            "temporary"
                                          ]
                                        },
                                        "tempId": {
                                          "type": "string",
                                          "minLength": 1,
                                          "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                        }
                                      }
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "refType",
                                    "mapping": {
                                      "existing": "#/ExistingWorkItemIdentity",
                                      "temporary": "#/TemporaryWorkItemIdentity"
                                    }
                                  }
                                },
                                "position": {
                                  "type": "object",
                                  "additionalProperties": false,
                                  "required": [
                                    "x",
                                    "y"
                                  ],
                                  "properties": {
                                    "x": {
                                      "type": "number"
                                    },
                                    "y": {
                                      "type": "number"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "root",
                          "sectionKey"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "layout.clear"
                            ]
                          },
                          "root": {
                            "oneOf": [
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "id"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "existing"
                                    ]
                                  },
                                  "id": {
                                    "type": "string",
                                    "format": "uuid"
                                  }
                                }
                              },
                              {
                                "type": "object",
                                "additionalProperties": false,
                                "required": [
                                  "refType",
                                  "tempId"
                                ],
                                "properties": {
                                  "refType": {
                                    "type": "string",
                                    "enum": [
                                      "temporary"
                                    ]
                                  },
                                  "tempId": {
                                    "type": "string",
                                    "minLength": 1,
                                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                                  }
                                }
                              }
                            ],
                            "discriminator": {
                              "propertyName": "refType",
                              "mapping": {
                                "existing": "#/ExistingWorkItemIdentity",
                                "temporary": "#/TemporaryWorkItemIdentity"
                              }
                            },
                            "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                          },
                          "sectionKey": {
                            "type": "string",
                            "minLength": 1
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "op",
                      "mapping": {
                        "workItem.create": "#/WorkItemCreateOperation",
                        "workItem.update": "#/WorkItemUpdateOperation",
                        "workItem.delete": "#/WorkItemDeleteOperation",
                        "section.replace": "#/WorkItemSectionReplaceOperation",
                        "section.clear": "#/WorkItemSectionClearOperation",
                        "relationship.create": "#/WorkItemRelationshipCreateOperation",
                        "relationship.update": "#/WorkItemRelationshipUpdateOperation",
                        "relationship.delete": "#/WorkItemRelationshipDeleteOperation",
                        "layout.replace": "#/WorkItemLayoutReplaceOperation",
                        "layout.clear": "#/WorkItemLayoutClearOperation"
                      }
                    }
                  }
                },
                "requirementOps": {
                  "type": "array",
                  "items": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "value"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "add"
                            ]
                          },
                          "value": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "statement"
                            ],
                            "properties": {
                              "statement": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Requirement statement text."
                              },
                              "group": {
                                "type": "string",
                                "pattern": "^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$",
                                "description": "Explicit feature-local grouping label using alphanumeric characters, spaces, and hyphens; omit when absent."
                              },
                              "designedBy": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DESIGN_DOC"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "x-discriminator-value": "DESIGN_DOC"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "MOCKUP"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                                      "x-discriminator-value": "MOCKUP"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DIAGRAM"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a diagram work item that shows the requirement's intended design.",
                                      "x-discriminator-value": "DIAGRAM"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                                      "MOCKUP": "#/FeatureRequirementMockupCitation",
                                      "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                                    }
                                  }
                                }
                              },
                              "fulfilledBy": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "TASK"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                                      "x-discriminator-value": "TASK"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "PLAN"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                                      "x-discriminator-value": "PLAN"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "TASK": "#/FeatureRequirementTaskCitation",
                                      "PLAN": "#/FeatureRequirementPlanCitation"
                                    }
                                  }
                                }
                              },
                              "contracts": {
                                "type": "array",
                                "items": {
                                  "allOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "entityType",
                                        "entityId"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "description": "Discriminator identifying the citation's API-level entity kind."
                                        },
                                        "entityId": {
                                          "type": "string",
                                          "format": "uuid",
                                          "description": "UUID of the cited entity."
                                        }
                                      }
                                    },
                                    {
                                      "type": "object",
                                      "required": [
                                        "entityType"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "enum": [
                                            "CONTRACT"
                                          ]
                                        }
                                      }
                                    }
                                  ],
                                  "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                                  "x-discriminator-value": "CONTRACT"
                                }
                              }
                            }
                          },
                          "before": {
                            "type": "string",
                            "format": "uuid",
                            "description": "Durable requirement ID to insert before; appends when absent or not found."
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "targetId"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "update"
                            ]
                          },
                          "targetId": {
                            "type": "string",
                            "format": "uuid",
                            "description": "Durable ID of the requirement to update."
                          },
                          "statement": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Replacement statement; changing it preserves the durable ID."
                          },
                          "group": {
                            "anyOf": [
                              {
                                "type": "string",
                                "pattern": "^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$",
                                "description": "Omit to preserve the group, provide an alphanumeric label using spaces or hyphens to set or rename it, or provide null to clear it."
                              },
                              {
                                "type": "null"
                              }
                            ]
                          },
                          "designedBy": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "add": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DESIGN_DOC"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "x-discriminator-value": "DESIGN_DOC"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "MOCKUP"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                                      "x-discriminator-value": "MOCKUP"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DIAGRAM"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a diagram work item that shows the requirement's intended design.",
                                      "x-discriminator-value": "DIAGRAM"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                                      "MOCKUP": "#/FeatureRequirementMockupCitation",
                                      "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                                    }
                                  }
                                },
                                "description": "Cites to add to the slot."
                              },
                              "remove": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DESIGN_DOC"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "x-discriminator-value": "DESIGN_DOC"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "MOCKUP"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                                      "x-discriminator-value": "MOCKUP"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "DIAGRAM"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a diagram work item that shows the requirement's intended design.",
                                      "x-discriminator-value": "DIAGRAM"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                                      "MOCKUP": "#/FeatureRequirementMockupCitation",
                                      "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                                    }
                                  }
                                },
                                "description": "Cites to remove from the slot."
                              }
                            }
                          },
                          "fulfilledBy": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "add": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "TASK"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                                      "x-discriminator-value": "TASK"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "PLAN"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                                      "x-discriminator-value": "PLAN"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "TASK": "#/FeatureRequirementTaskCitation",
                                      "PLAN": "#/FeatureRequirementPlanCitation"
                                    }
                                  }
                                },
                                "description": "Cites to add to the slot."
                              },
                              "remove": {
                                "type": "array",
                                "items": {
                                  "oneOf": [
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "TASK"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                                      "x-discriminator-value": "TASK"
                                    },
                                    {
                                      "allOf": [
                                        {
                                          "type": "object",
                                          "additionalProperties": false,
                                          "required": [
                                            "entityType",
                                            "entityId"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "description": "Discriminator identifying the citation's API-level entity kind."
                                            },
                                            "entityId": {
                                              "type": "string",
                                              "format": "uuid",
                                              "description": "UUID of the cited entity."
                                            }
                                          }
                                        },
                                        {
                                          "type": "object",
                                          "required": [
                                            "entityType"
                                          ],
                                          "properties": {
                                            "entityType": {
                                              "type": "string",
                                              "enum": [
                                                "PLAN"
                                              ]
                                            }
                                          }
                                        }
                                      ],
                                      "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                                      "x-discriminator-value": "PLAN"
                                    }
                                  ],
                                  "discriminator": {
                                    "propertyName": "entityType",
                                    "mapping": {
                                      "TASK": "#/FeatureRequirementTaskCitation",
                                      "PLAN": "#/FeatureRequirementPlanCitation"
                                    }
                                  }
                                },
                                "description": "Cites to remove from the slot."
                              }
                            }
                          },
                          "contracts": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "add": {
                                "type": "array",
                                "items": {
                                  "allOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "entityType",
                                        "entityId"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "description": "Discriminator identifying the citation's API-level entity kind."
                                        },
                                        "entityId": {
                                          "type": "string",
                                          "format": "uuid",
                                          "description": "UUID of the cited entity."
                                        }
                                      }
                                    },
                                    {
                                      "type": "object",
                                      "required": [
                                        "entityType"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "enum": [
                                            "CONTRACT"
                                          ]
                                        }
                                      }
                                    }
                                  ],
                                  "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                                  "x-discriminator-value": "CONTRACT"
                                },
                                "description": "Cites to add to the slot."
                              },
                              "remove": {
                                "type": "array",
                                "items": {
                                  "allOf": [
                                    {
                                      "type": "object",
                                      "additionalProperties": false,
                                      "required": [
                                        "entityType",
                                        "entityId"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "description": "Discriminator identifying the citation's API-level entity kind."
                                        },
                                        "entityId": {
                                          "type": "string",
                                          "format": "uuid",
                                          "description": "UUID of the cited entity."
                                        }
                                      }
                                    },
                                    {
                                      "type": "object",
                                      "required": [
                                        "entityType"
                                      ],
                                      "properties": {
                                        "entityType": {
                                          "type": "string",
                                          "enum": [
                                            "CONTRACT"
                                          ]
                                        }
                                      }
                                    }
                                  ],
                                  "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                                  "x-discriminator-value": "CONTRACT"
                                },
                                "description": "Cites to remove from the slot."
                              }
                            }
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "op",
                          "targetId"
                        ],
                        "properties": {
                          "op": {
                            "type": "string",
                            "enum": [
                              "delete"
                            ]
                          },
                          "targetId": {
                            "type": "string",
                            "format": "uuid",
                            "description": "Durable ID of the requirement to delete."
                          }
                        }
                      }
                    ],
                    "description": "Ordered add, update, or delete operation for a FEATURE requirement."
                  }
                }
              }
            },
            {
              "type": "object",
              "additionalProperties": false,
              "description": "Same change shape as a live design-doc edit; status stays with the baseline.",
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1
                },
                "template": {
                  "type": "string",
                  "description": "Template used to structure the design document.",
                  "enum": [
                    "CLASSIC",
                    "ADR",
                    "RFC",
                    "BRAINSTORM",
                    "DECISION",
                    "PLAN_DOCUMENT"
                  ],
                  "example": "CLASSIC"
                },
                "tags": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "summary": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "parentEntityId": {
                  "anyOf": [
                    {
                      "type": "string",
                      "format": "uuid"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "parentEntityType": {
                  "anyOf": [
                    {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "Entity type that owns a design document as its parent.",
                          "enum": [
                            "TASK",
                            "DESIGN_DOC"
                          ],
                          "example": "TASK"
                        }
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "sections": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "key",
                      "content"
                    ],
                    "properties": {
                      "key": {
                        "type": "string",
                        "minLength": 1
                      },
                      "content": {
                        "type": "string"
                      },
                      "order": {
                        "anyOf": [
                          {
                            "type": "integer"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    }
                  }
                }
              }
            }
          ]
        },
        "dependencies": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "edgeType",
              "targetEntityType",
              "targetEntityId"
            ],
            "properties": {
              "edgeType": {
                "type": "string",
                "enum": [
                  "DEPENDS_ON"
                ]
              },
              "targetEntityType": {
                "type": "string",
                "enum": [
                  "TASK"
                ],
                "description": "Canonical work-item identity. Eligible types have registry role work-item, or the platform PLAN type explicitly. Completion remains owned by Work Items and Plans."
              },
              "targetEntityId": {
                "type": "string",
                "format": "uuid"
              }
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operation",
        "futureId",
        "expectedRevision"
      ],
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "CANCEL"
          ]
        },
        "futureId": {
          "type": "string",
          "format": "uuid"
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        }
      }
    }
  ]
};
export const futureWorkItemChangesSchema = {
  "type": "object",
  "additionalProperties": false,
  "description": "Same change shape as a live work-item edit. Status, type, config and source stay with the baseline because Apply does not write them.",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "priority": {
      "type": "string",
      "enum": [
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL"
      ],
      "description": "The priority level of an item.",
      "example": "HIGH"
    },
    "tag": {
      "type": "string",
      "enum": [
        "product",
        "frontend",
        "backend",
        "infra",
        "design",
        "AI"
      ],
      "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
      "example": "backend"
    },
    "initiativeId": {
      "type": "string",
      "format": "uuid"
    },
    "dueDate": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "assigneeId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    },
    "parentTaskId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "key",
          "content"
        ],
        "properties": {
          "key": {
            "type": "string",
            "description": "Section key from the work-item type definition."
          },
          "content": {
            "anyOf": [
              {
                "description": "Section content to initialize or update. Markdown sections use strings; JSON sections use schema-backed values, html/css sections use the strict WorkItemHtmlCssSectionContent object, and structured-mockup sections use WorkItemStructuredMockupSectionContent.\n"
              },
              {
                "type": "null"
              }
            ]
          },
          "order": {
            "type": "integer",
            "description": "Optional ordering index for rendering sections."
          }
        }
      }
    },
    "operations": {
      "type": "array",
      "description": "Generic graph edits within the target root, its children and incident relationships. The root cannot be deleted or change type or status. Applied to the selected non-live graph, including during refinement.",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref",
              "name"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "workItem.create"
                ]
              },
              "ref": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "refType",
                  "tempId"
                ],
                "properties": {
                  "refType": {
                    "type": "string",
                    "enum": [
                      "temporary"
                    ]
                  },
                  "tempId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                  }
                }
              },
              "name": {
                "type": "string",
                "minLength": 1
              },
              "type": {
                "type": "string",
                "description": "An open work-item type key — either one of the system values (STANDARD, FEATURE, GOAL, BUG, PLAN, PLAN_STAGE, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, TASK_MONITOR) or a project-scoped custom key (e.g. \"MARKETING\"). Used wherever a type filter or type reference must accept custom types registered via the work-item type registry.\n",
                "example": "STANDARD"
              },
              "parent": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "status": {
                "type": "string",
                "enum": [
                  "GENERATED",
                  "BACKLOG",
                  "READY",
                  "REFINING",
                  "BLOCKED",
                  "REFINING_DESCRIPTION",
                  "REFINING_DETAILS",
                  "REFINING_ACCEPTANCE_CRITERIA",
                  "GENERATING_DESCRIPTION",
                  "GENERATING_DETAILS",
                  "GENERATING_DESCRIPTION_AND_DETAILS",
                  "GENERATING_ACCEPTANCE_CRITERIA",
                  "GENERATING_ALL",
                  "ACTIVE",
                  "ON_HOLD",
                  "VERIFYING",
                  "COMPLETED",
                  "CANCELLED",
                  "ARCHIVED",
                  "SUPERSEDED"
                ],
                "description": "Unified work status for initiatives and tasks"
              },
              "priority": {
                "type": "string",
                "enum": [
                  "LOW",
                  "MEDIUM",
                  "HIGH",
                  "CRITICAL"
                ],
                "description": "The priority level of an item.",
                "example": "HIGH"
              },
              "dueDate": {
                "anyOf": [
                  {
                    "type": "string",
                    "format": "date-time"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "assigneeId": {
                "anyOf": [
                  {
                    "type": "string",
                    "format": "uuid"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tag": {
                "type": "string",
                "enum": [
                  "product",
                  "frontend",
                  "backend",
                  "infra",
                  "design",
                  "AI"
                ],
                "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                "example": "backend"
              },
              "serviceIds": {
                "type": "array",
                "description": "Optional complete known Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                "items": {
                  "type": "string",
                  "format": "branded-ServiceId",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                  "description": "Unique identifier for a service (branded type)",
                  "example": "550e8400-e29b-41d4-a716-446655440015",
                  "x-typescript-type": "ServiceId",
                  "x-brand": "ServiceId",
                  "x-semantic-type": "resource-identifier"
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "workItem.update"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "name": {
                "type": "string",
                "minLength": 1
              },
              "parent": {
                "anyOf": [
                  {
                    "allOf": [
                      {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "id"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "existing"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "format": "uuid"
                              }
                            }
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                              "refType",
                              "tempId"
                            ],
                            "properties": {
                              "refType": {
                                "type": "string",
                                "enum": [
                                  "temporary"
                                ]
                              },
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                              }
                            }
                          }
                        ],
                        "discriminator": {
                          "propertyName": "refType",
                          "mapping": {
                            "existing": "#/ExistingWorkItemIdentity",
                            "temporary": "#/TemporaryWorkItemIdentity"
                          }
                        },
                        "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                      }
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "status": {
                "type": "string",
                "enum": [
                  "GENERATED",
                  "BACKLOG",
                  "READY",
                  "REFINING",
                  "BLOCKED",
                  "REFINING_DESCRIPTION",
                  "REFINING_DETAILS",
                  "REFINING_ACCEPTANCE_CRITERIA",
                  "GENERATING_DESCRIPTION",
                  "GENERATING_DETAILS",
                  "GENERATING_DESCRIPTION_AND_DETAILS",
                  "GENERATING_ACCEPTANCE_CRITERIA",
                  "GENERATING_ALL",
                  "ACTIVE",
                  "ON_HOLD",
                  "VERIFYING",
                  "COMPLETED",
                  "CANCELLED",
                  "ARCHIVED",
                  "SUPERSEDED"
                ],
                "description": "Unified work status for initiatives and tasks"
              },
              "priority": {
                "type": "string",
                "enum": [
                  "LOW",
                  "MEDIUM",
                  "HIGH",
                  "CRITICAL"
                ],
                "description": "The priority level of an item.",
                "example": "HIGH"
              },
              "dueDate": {
                "anyOf": [
                  {
                    "type": "string",
                    "format": "date-time"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "assigneeId": {
                "anyOf": [
                  {
                    "type": "string",
                    "format": "uuid"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tag": {
                "type": "string",
                "enum": [
                  "product",
                  "frontend",
                  "backend",
                  "infra",
                  "design",
                  "AI"
                ],
                "description": "Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n",
                "example": "backend"
              },
              "serviceIds": {
                "type": "array",
                "description": "Optional complete known replacement Service assignment array for a work-item type whose project-effective registry role is work-item. Preserve this value as a JSON array. Repeated IDs are accepted with an advisory finding and produce one assignment per unique valid ID. Generic work-item authoring continues to require project-valid references, and the field is rejected for other registry roles. For plan-materialized STANDARD children of PLAN_STAGE, omitted or empty Service coverage remains admissible after plan-specific advisory normalization; invalid project Service IDs are omitted before persistence.",
                "items": {
                  "type": "string",
                  "format": "branded-ServiceId",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                  "description": "Unique identifier for a service (branded type)",
                  "example": "550e8400-e29b-41d4-a716-446655440015",
                  "x-typescript-type": "ServiceId",
                  "x-brand": "ServiceId",
                  "x-semantic-type": "resource-identifier"
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "workItem.delete"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref",
              "key",
              "content"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "section.replace"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "key": {
                "type": "string",
                "minLength": 1
              },
              "content": {
                "anyOf": [
                  {
                    "description": "Any JSON value. Markdown sections use strings; schema-backed JSON sections may use objects, arrays, numbers, booleans, or null; html/css sections use the strict WorkItemHtmlCssSectionContent object; structured-mockup sections use the versioned WorkItemStructuredMockupSectionContent object. This envelope remains intentionally broad so validation can dispatch by the resolved section definition.\n"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref",
              "key"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "section.clear"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "key": {
                "type": "string",
                "minLength": 1
              }
            }
          },
          {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "op",
                  "ref",
                  "source",
                  "target",
                  "edgeType"
                ],
                "properties": {
                  "op": {
                    "type": "string",
                    "enum": [
                      "relationship.create"
                    ]
                  },
                  "ref": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  "source": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "edgeType": {
                    "type": "string",
                    "enum": [
                      "RELATED_TO",
                      "DEPENDS_ON",
                      "DERIVES_FROM",
                      "SUPERSEDES",
                      "CONTRADICTS",
                      "EVOLVES",
                      "TRACKS",
                      "PROPOSED_TOGETHER",
                      "FULFILLED_BY",
                      "GUARANTEES",
                      "IMPLEMENTS",
                      "CONSUMES"
                    ],
                    "description": "Agent-authored relationship types in the meta category. GUARANTEES, IMPLEMENTS and CONSUMES connect TASK DIAGRAM_ELEMENT sources to TASK CONTRACT targets."
                  },
                  "category": {
                    "type": "string",
                    "enum": [
                      "meta"
                    ]
                  },
                  "direction": {
                    "anyOf": [
                      {
                        "allOf": [
                          {
                            "type": "string",
                            "enum": [
                              "forward",
                              "backward"
                            ],
                            "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                          }
                        ]
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "predicate": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "reasoning": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "metadata": {
                    "anyOf": [
                      {
                        "type": "object",
                        "additionalProperties": true
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "op",
                  "ref",
                  "source",
                  "target",
                  "edgeType",
                  "category",
                  "direction"
                ],
                "properties": {
                  "op": {
                    "type": "string",
                    "enum": [
                      "relationship.create"
                    ]
                  },
                  "ref": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  "source": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "edgeType": {
                    "type": "string",
                    "enum": [
                      "STANDARD"
                    ]
                  },
                  "category": {
                    "type": "string",
                    "enum": [
                      "flow"
                    ]
                  },
                  "direction": {
                    "type": "string",
                    "enum": [
                      "forward",
                      "backward"
                    ],
                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                  },
                  "actionLabel": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": ".*\\S.*",
                    "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                  },
                  "reasoning": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "metadata": {
                    "anyOf": [
                      {
                        "type": "object",
                        "additionalProperties": true
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "op",
                  "ref",
                  "source",
                  "target",
                  "edgeType",
                  "category",
                  "direction",
                  "predicate"
                ],
                "properties": {
                  "op": {
                    "type": "string",
                    "enum": [
                      "relationship.create"
                    ]
                  },
                  "ref": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  "source": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "edgeType": {
                    "type": "string",
                    "enum": [
                      "CONDITIONAL"
                    ]
                  },
                  "category": {
                    "type": "string",
                    "enum": [
                      "flow"
                    ]
                  },
                  "direction": {
                    "type": "string",
                    "enum": [
                      "forward",
                      "backward"
                    ],
                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                  },
                  "predicate": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                    "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                  },
                  "actionLabel": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": ".*\\S.*",
                    "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                  },
                  "reasoning": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "metadata": {
                    "anyOf": [
                      {
                        "type": "object",
                        "additionalProperties": true
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "op",
                  "ref",
                  "source",
                  "target",
                  "edgeType",
                  "category"
                ],
                "properties": {
                  "op": {
                    "type": "string",
                    "enum": [
                      "relationship.create"
                    ]
                  },
                  "ref": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  },
                  "source": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "id"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "existing"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          }
                        }
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "refType",
                          "tempId"
                        ],
                        "properties": {
                          "refType": {
                            "type": "string",
                            "enum": [
                              "temporary"
                            ]
                          },
                          "tempId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                          }
                        }
                      }
                    ],
                    "discriminator": {
                      "propertyName": "refType",
                      "mapping": {
                        "existing": "#/ExistingWorkItemIdentity",
                        "temporary": "#/TemporaryWorkItemIdentity"
                      }
                    },
                    "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
                  },
                  "edgeType": {
                    "type": "string",
                    "enum": [
                      "LOOP"
                    ]
                  },
                  "category": {
                    "type": "string",
                    "enum": [
                      "flow"
                    ]
                  },
                  "predicate": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": "^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$",
                    "description": "Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n"
                  },
                  "actionLabel": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": ".*\\S.*",
                    "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                  },
                  "reasoning": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "metadata": {
                    "anyOf": [
                      {
                        "type": "object",
                        "additionalProperties": true
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              }
            ],
            "discriminator": {
              "propertyName": "edgeType",
              "mapping": {
                "RELATED_TO": "#/WorkItemMetaRelationshipCreateOperation",
                "DEPENDS_ON": "#/WorkItemMetaRelationshipCreateOperation",
                "DERIVES_FROM": "#/WorkItemMetaRelationshipCreateOperation",
                "SUPERSEDES": "#/WorkItemMetaRelationshipCreateOperation",
                "CONTRADICTS": "#/WorkItemMetaRelationshipCreateOperation",
                "EVOLVES": "#/WorkItemMetaRelationshipCreateOperation",
                "TRACKS": "#/WorkItemMetaRelationshipCreateOperation",
                "PROPOSED_TOGETHER": "#/WorkItemMetaRelationshipCreateOperation",
                "FULFILLED_BY": "#/WorkItemMetaRelationshipCreateOperation",
                "GUARANTEES": "#/WorkItemMetaRelationshipCreateOperation",
                "IMPLEMENTS": "#/WorkItemMetaRelationshipCreateOperation",
                "CONSUMES": "#/WorkItemMetaRelationshipCreateOperation",
                "STANDARD": "#/WorkItemStandardRelationshipCreateOperation",
                "CONDITIONAL": "#/WorkItemConditionalRelationshipCreateOperation",
                "LOOP": "#/WorkItemLoopRelationshipCreateOperation"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "relationship.update"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingRelationshipIdentity",
                    "temporary": "#/TemporaryRelationshipIdentity"
                  }
                }
              },
              "source": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "sourceEntityType": {
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
                  "IMPLEMENTATION_HINT"
                ],
                "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
              },
              "target": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "targetEntityType": {
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
                  "IMPLEMENTATION_HINT"
                ],
                "description": "Canonical entity type for an agent-edge endpoint. The graph service maps each value to a closed set of Neo4j node labels when resolving or creating missing endpoints for edge writes. `USER` is intentionally excluded because users are not stored as entity-registry graph nodes.\n"
              },
              "edgeType": {
                "type": "string",
                "enum": [
                  "RELATED_TO",
                  "DEPENDS_ON",
                  "DERIVES_FROM",
                  "SUPERSEDES",
                  "CONTRADICTS",
                  "EVOLVES",
                  "TRACKS",
                  "PROPOSED_TOGETHER",
                  "FULFILLED_BY",
                  "GUARANTEES",
                  "IMPLEMENTS",
                  "CONSUMES",
                  "STANDARD",
                  "CONDITIONAL",
                  "LOOP"
                ],
                "description": "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow`, requires direction,\n  and may carry an action label.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate. It may also carry an action label.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional. It may also carry an action\n  label.\n"
              },
              "category": {
                "type": "string",
                "enum": [
                  "meta",
                  "flow"
                ],
                "default": "meta",
                "description": "Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n"
              },
              "direction": {
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "forward",
                      "backward"
                    ],
                    "description": "Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "predicate": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "actionLabel": {
                "anyOf": [
                  {
                    "allOf": [
                      {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200,
                        "pattern": ".*\\S.*",
                        "description": "Optional plain-language user action that triggers this flow transition, such as \"tap Continue\". Distinct from a CONDITIONAL branch predicate.\n"
                      }
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reasoning": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "metadata": {
                "anyOf": [
                  {
                    "type": "object",
                    "additionalProperties": true
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "ref"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "relationship.delete"
                ]
              },
              "ref": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingRelationshipIdentity",
                    "temporary": "#/TemporaryRelationshipIdentity"
                  }
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "root",
              "sectionKey",
              "entries"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "layout.replace"
                ]
              },
              "root": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "sectionKey": {
                "type": "string",
                "minLength": 1
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "node",
                    "position"
                  ],
                  "properties": {
                    "node": {
                      "oneOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "refType",
                            "id"
                          ],
                          "properties": {
                            "refType": {
                              "type": "string",
                              "enum": [
                                "existing"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "format": "uuid"
                            }
                          }
                        },
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "refType",
                            "tempId"
                          ],
                          "properties": {
                            "refType": {
                              "type": "string",
                              "enum": [
                                "temporary"
                              ]
                            },
                            "tempId": {
                              "type": "string",
                              "minLength": 1,
                              "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                            }
                          }
                        }
                      ],
                      "discriminator": {
                        "propertyName": "refType",
                        "mapping": {
                          "existing": "#/ExistingWorkItemIdentity",
                          "temporary": "#/TemporaryWorkItemIdentity"
                        }
                      }
                    },
                    "position": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "x",
                        "y"
                      ],
                      "properties": {
                        "x": {
                          "type": "number"
                        },
                        "y": {
                          "type": "number"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "root",
              "sectionKey"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "layout.clear"
                ]
              },
              "root": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "id"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "existing"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "format": "uuid"
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "refType",
                      "tempId"
                    ],
                    "properties": {
                      "refType": {
                        "type": "string",
                        "enum": [
                          "temporary"
                        ]
                      },
                      "tempId": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Change-set-scoped temporary identifier. It is never converted into a persisted id during projection."
                      }
                    }
                  }
                ],
                "discriminator": {
                  "propertyName": "refType",
                  "mapping": {
                    "existing": "#/ExistingWorkItemIdentity",
                    "temporary": "#/TemporaryWorkItemIdentity"
                  }
                },
                "description": "Structurally distinct identity for an existing work item or a change-set-scoped temporary work item."
              },
              "sectionKey": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        ],
        "discriminator": {
          "propertyName": "op",
          "mapping": {
            "workItem.create": "#/WorkItemCreateOperation",
            "workItem.update": "#/WorkItemUpdateOperation",
            "workItem.delete": "#/WorkItemDeleteOperation",
            "section.replace": "#/WorkItemSectionReplaceOperation",
            "section.clear": "#/WorkItemSectionClearOperation",
            "relationship.create": "#/WorkItemRelationshipCreateOperation",
            "relationship.update": "#/WorkItemRelationshipUpdateOperation",
            "relationship.delete": "#/WorkItemRelationshipDeleteOperation",
            "layout.replace": "#/WorkItemLayoutReplaceOperation",
            "layout.clear": "#/WorkItemLayoutClearOperation"
          }
        }
      }
    },
    "requirementOps": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "value"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "add"
                ]
              },
              "value": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "statement"
                ],
                "properties": {
                  "statement": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Requirement statement text."
                  },
                  "group": {
                    "type": "string",
                    "pattern": "^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$",
                    "description": "Explicit feature-local grouping label using alphanumeric characters, spaces, and hyphens; omit when absent."
                  },
                  "designedBy": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DESIGN_DOC"
                                  ]
                                }
                              }
                            }
                          ],
                          "x-discriminator-value": "DESIGN_DOC"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "MOCKUP"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                          "x-discriminator-value": "MOCKUP"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DIAGRAM"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a diagram work item that shows the requirement's intended design.",
                          "x-discriminator-value": "DIAGRAM"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                          "MOCKUP": "#/FeatureRequirementMockupCitation",
                          "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                        }
                      }
                    }
                  },
                  "fulfilledBy": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "TASK"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                          "x-discriminator-value": "TASK"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "PLAN"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                          "x-discriminator-value": "PLAN"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "TASK": "#/FeatureRequirementTaskCitation",
                          "PLAN": "#/FeatureRequirementPlanCitation"
                        }
                      }
                    }
                  },
                  "contracts": {
                    "type": "array",
                    "items": {
                      "allOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "entityType",
                            "entityId"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "description": "Discriminator identifying the citation's API-level entity kind."
                            },
                            "entityId": {
                              "type": "string",
                              "format": "uuid",
                              "description": "UUID of the cited entity."
                            }
                          }
                        },
                        {
                          "type": "object",
                          "required": [
                            "entityType"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "enum": [
                                "CONTRACT"
                              ]
                            }
                          }
                        }
                      ],
                      "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                      "x-discriminator-value": "CONTRACT"
                    }
                  }
                }
              },
              "before": {
                "type": "string",
                "format": "uuid",
                "description": "Durable requirement ID to insert before; appends when absent or not found."
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "targetId"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "update"
                ]
              },
              "targetId": {
                "type": "string",
                "format": "uuid",
                "description": "Durable ID of the requirement to update."
              },
              "statement": {
                "type": "string",
                "minLength": 1,
                "description": "Replacement statement; changing it preserves the durable ID."
              },
              "group": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$",
                    "description": "Omit to preserve the group, provide an alphanumeric label using spaces or hyphens to set or rename it, or provide null to clear it."
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "designedBy": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "add": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DESIGN_DOC"
                                  ]
                                }
                              }
                            }
                          ],
                          "x-discriminator-value": "DESIGN_DOC"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "MOCKUP"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                          "x-discriminator-value": "MOCKUP"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DIAGRAM"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a diagram work item that shows the requirement's intended design.",
                          "x-discriminator-value": "DIAGRAM"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                          "MOCKUP": "#/FeatureRequirementMockupCitation",
                          "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                        }
                      }
                    },
                    "description": "Cites to add to the slot."
                  },
                  "remove": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DESIGN_DOC"
                                  ]
                                }
                              }
                            }
                          ],
                          "x-discriminator-value": "DESIGN_DOC"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "MOCKUP"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a mockup work item that shows the requirement's intended interface.",
                          "x-discriminator-value": "MOCKUP"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "DIAGRAM"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a diagram work item that shows the requirement's intended design.",
                          "x-discriminator-value": "DIAGRAM"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "DESIGN_DOC": "#/FeatureRequirementDesignDocCitation",
                          "MOCKUP": "#/FeatureRequirementMockupCitation",
                          "DIAGRAM": "#/FeatureRequirementDiagramCitation"
                        }
                      }
                    },
                    "description": "Cites to remove from the slot."
                  }
                }
              },
              "fulfilledBy": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "add": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "TASK"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                          "x-discriminator-value": "TASK"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "PLAN"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                          "x-discriminator-value": "PLAN"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "TASK": "#/FeatureRequirementTaskCitation",
                          "PLAN": "#/FeatureRequirementPlanCitation"
                        }
                      }
                    },
                    "description": "Cites to add to the slot."
                  },
                  "remove": {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "TASK"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a non-PLAN work item; its subtype and project membership are validated semantically.",
                          "x-discriminator-value": "TASK"
                        },
                        {
                          "allOf": [
                            {
                              "type": "object",
                              "additionalProperties": false,
                              "required": [
                                "entityType",
                                "entityId"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "description": "Discriminator identifying the citation's API-level entity kind."
                                },
                                "entityId": {
                                  "type": "string",
                                  "format": "uuid",
                                  "description": "UUID of the cited entity."
                                }
                              }
                            },
                            {
                              "type": "object",
                              "required": [
                                "entityType"
                              ],
                              "properties": {
                                "entityType": {
                                  "type": "string",
                                  "enum": [
                                    "PLAN"
                                  ]
                                }
                              }
                            }
                          ],
                          "description": "Citation to a PLAN work item, represented distinctly from an ordinary TASK citation.",
                          "x-discriminator-value": "PLAN"
                        }
                      ],
                      "discriminator": {
                        "propertyName": "entityType",
                        "mapping": {
                          "TASK": "#/FeatureRequirementTaskCitation",
                          "PLAN": "#/FeatureRequirementPlanCitation"
                        }
                      }
                    },
                    "description": "Cites to remove from the slot."
                  }
                }
              },
              "contracts": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "add": {
                    "type": "array",
                    "items": {
                      "allOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "entityType",
                            "entityId"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "description": "Discriminator identifying the citation's API-level entity kind."
                            },
                            "entityId": {
                              "type": "string",
                              "format": "uuid",
                              "description": "UUID of the cited entity."
                            }
                          }
                        },
                        {
                          "type": "object",
                          "required": [
                            "entityType"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "enum": [
                                "CONTRACT"
                              ]
                            }
                          }
                        }
                      ],
                      "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                      "x-discriminator-value": "CONTRACT"
                    },
                    "description": "Cites to add to the slot."
                  },
                  "remove": {
                    "type": "array",
                    "items": {
                      "allOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": [
                            "entityType",
                            "entityId"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "description": "Discriminator identifying the citation's API-level entity kind."
                            },
                            "entityId": {
                              "type": "string",
                              "format": "uuid",
                              "description": "UUID of the cited entity."
                            }
                          }
                        },
                        {
                          "type": "object",
                          "required": [
                            "entityType"
                          ],
                          "properties": {
                            "entityType": {
                              "type": "string",
                              "enum": [
                                "CONTRACT"
                              ]
                            }
                          }
                        }
                      ],
                      "description": "Citation to a CONTRACT work item; its subtype and project membership are validated semantically.",
                      "x-discriminator-value": "CONTRACT"
                    },
                    "description": "Cites to remove from the slot."
                  }
                }
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "op",
              "targetId"
            ],
            "properties": {
              "op": {
                "type": "string",
                "enum": [
                  "delete"
                ]
              },
              "targetId": {
                "type": "string",
                "format": "uuid",
                "description": "Durable ID of the requirement to delete."
              }
            }
          }
        ],
        "description": "Ordered add, update, or delete operation for a FEATURE requirement."
      }
    }
  }
};
export const futureDesignDocChangesSchema = {
  "type": "object",
  "additionalProperties": false,
  "description": "Same change shape as a live design-doc edit; status stays with the baseline.",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "template": {
      "type": "string",
      "description": "Template used to structure the design document.",
      "enum": [
        "CLASSIC",
        "ADR",
        "RFC",
        "BRAINSTORM",
        "DECISION",
        "PLAN_DOCUMENT"
      ],
      "example": "CLASSIC"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "summary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "parentEntityId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid"
        },
        {
          "type": "null"
        }
      ]
    },
    "parentEntityType": {
      "anyOf": [
        {
          "allOf": [
            {
              "type": "string",
              "description": "Entity type that owns a design document as its parent.",
              "enum": [
                "TASK",
                "DESIGN_DOC"
              ],
              "example": "TASK"
            }
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "content"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1
          },
          "content": {
            "type": "string"
          },
          "order": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      }
    }
  }
};
