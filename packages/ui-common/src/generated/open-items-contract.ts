// Generated from OpenAPI by scripts/generate-open-items-contract.cjs.
export const openItemsSchemas = {
  OpenItemRevision: {
    type: "integer",
    format: "int64",
    minimum: 1,
    description:
      "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
  },
  OpenItemIdempotencyKey: {
    type: "string",
    minLength: 8,
    maxLength: 128,
    pattern: "^[A-Za-z0-9._:-]+$",
    description:
      "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
  },
  OpenItemPositionKey: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[0-9A-Za-z]+$",
    description:
      "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
  },
  OpenItemGroupId: {
    type: "string",
    format: "uuid",
    description:
      "Stable server-assigned virtual-group identity. Groups reference no project topology.",
  },
  OpenItemGroupName: {
    type: "string",
    minLength: 1,
    maxLength: 80,
    description: "Display name of a virtual group (trimmed, non-blank).",
  },
  OpenItemNote: {
    anyOf: [
      {
        type: "string",
        maxLength: 2000,
        description: "Why-open note. Null or empty clears the note.",
      },
      {
        type: "null",
      },
    ],
  },
  OpenItemRef: {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    description:
      "Canonical entity identity of an Open Item, unique within a collection.",
    properties: {
      entityType: {
        type: "string",
        enum: [
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
          "USER",
        ],
        description:
          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
      },
      entityId: {
        type: "string",
        format: "uuid",
      },
    },
  },
  OpenItemPremise: {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    description: "Canonical identity; intent applies to current server state.",
    properties: {
      entityType: {
        type: "string",
        enum: [
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
          "USER",
        ],
        description:
          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
      },
      entityId: {
        type: "string",
        format: "uuid",
      },
    },
  },
  OpenItemLineageEntry: {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    description:
      "One route-owned ancestor of an Open Item, nearest-root first.",
    properties: {
      entityType: {
        type: "string",
        enum: [
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
          "USER",
        ],
        description:
          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
      },
      entityId: {
        type: "string",
        format: "uuid",
      },
    },
  },
  OpenItemLineage: {
    type: "array",
    maxItems: 16,
    description:
      "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["entityType", "entityId"],
      description:
        "One route-owned ancestor of an Open Item, nearest-root first.",
      properties: {
        entityType: {
          type: "string",
          enum: [
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
            "USER",
          ],
          description:
            "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
        },
        entityId: {
          type: "string",
          format: "uuid",
        },
      },
    },
  },
  OpenItemPresentation: {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    description:
      "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
    properties: {
      label: {
        type: "string",
        minLength: 1,
        maxLength: 300,
      },
      workItemTypeKey: {
        anyOf: [
          {
            type: "string",
            maxLength: 64,
            description:
              "Registry work-item type key for registry-backed icons (work items only).",
          },
          {
            type: "null",
          },
        ],
      },
      agentSessionType: {
        anyOf: [
          {
            type: "string",
            maxLength: 64,
            description:
              "Agent Session type discriminator (agent sessions only).",
          },
          {
            type: "null",
          },
        ],
      },
      routeParams: {
        anyOf: [
          {
            type: "object",
            maxProperties: 4,
            additionalProperties: {
              type: "string",
              maxLength: 128,
            },
            description:
              "Specialized canonical-destination route fields beyond entity identity.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  OpenItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "entityType",
      "entityId",
      "note",
      "pinned",
      "position",
      "groupId",
      "memberPosition",
      "revision",
      "lineage",
      "presentation",
      "removedAt",
      "updatedAt",
      "goalTrackedWorkFilter",
      "goalCollapsed",
    ],
    properties: {
      goalTrackedWorkFilter: {
        type: "string",
        enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
        default: "ACTIVE_AND_BACKLOG",
        description:
          "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
      },
      goalCollapsed: {
        type: "boolean",
        description: "Persisted Goal row disclosure; true means collapsed.",
      },
      entityType: {
        type: "string",
        enum: [
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
          "USER",
        ],
        description:
          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
      },
      entityId: {
        type: "string",
        format: "uuid",
      },
      note: {
        anyOf: [
          {
            type: "string",
            maxLength: 2000,
            description: "Why-open note. Null or empty clears the note.",
          },
          {
            type: "null",
          },
        ],
      },
      pinned: {
        type: "boolean",
      },
      position: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[0-9A-Za-z]+$",
        description:
          "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
      },
      groupId: {
        anyOf: [
          {
            allOf: [
              {
                type: "string",
                format: "uuid",
                description:
                  "Stable server-assigned virtual-group identity. Groups reference no project topology.",
              },
            ],
            description: "Virtual group membership; null when ungrouped.",
          },
          {
            type: "null",
          },
        ],
      },
      memberPosition: {
        anyOf: [
          {
            allOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: 64,
                pattern: "^[0-9A-Za-z]+$",
                description:
                  "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
              },
            ],
            description:
              "Order within the group; null exactly when groupId is null.",
          },
          {
            type: "null",
          },
        ],
      },
      revision: {
        type: "integer",
        format: "int64",
        minimum: 1,
        description:
          "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
      },
      lineage: {
        type: "array",
        maxItems: 16,
        description:
          "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "One route-owned ancestor of an Open Item, nearest-root first.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      presentation: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        description:
          "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 300,
          },
          workItemTypeKey: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Registry work-item type key for registry-backed icons (work items only).",
              },
              {
                type: "null",
              },
            ],
          },
          agentSessionType: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Agent Session type discriminator (agent sessions only).",
              },
              {
                type: "null",
              },
            ],
          },
          routeParams: {
            anyOf: [
              {
                type: "object",
                maxProperties: 4,
                additionalProperties: {
                  type: "string",
                  maxLength: 128,
                },
                description:
                  "Specialized canonical-destination route fields beyond entity identity.",
              },
              {
                type: "null",
              },
            ],
          },
        },
      },
      removedAt: {
        anyOf: [
          {
            type: "string",
            format: "date-time",
            description:
              "Removal metadata. Non-null only in mutation results that removed the item; reads return open items only.",
          },
          {
            type: "null",
          },
        ],
      },
      updatedAt: {
        type: "string",
        format: "date-time",
      },
    },
  },
  OpenItemGroup: {
    type: "object",
    additionalProperties: false,
    required: [
      "groupId",
      "name",
      "position",
      "collapsed",
      "revision",
      "updatedAt",
    ],
    properties: {
      groupId: {
        type: "string",
        format: "uuid",
        description:
          "Stable server-assigned virtual-group identity. Groups reference no project topology.",
      },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Display name of a virtual group (trimmed, non-blank).",
      },
      position: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[0-9A-Za-z]+$",
        description:
          "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
      },
      collapsed: {
        type: "boolean",
      },
      revision: {
        type: "integer",
        format: "int64",
        minimum: 1,
        description:
          "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
      },
      updatedAt: {
        type: "string",
        format: "date-time",
      },
    },
  },
  OpenItemsAbsentCollection: {
    type: "object",
    additionalProperties: false,
    required: ["state"],
    description:
      "No collection exists for this user and project; migration is permitted.",
    properties: {
      state: {
        type: "string",
        enum: ["ABSENT"],
      },
    },
  },
  OpenItemsPresentCollection: {
    type: "object",
    additionalProperties: false,
    required: ["state", "revision", "items", "groups"],
    description:
      "Canonical collection. Empty arrays mean an intentionally empty collection (for example after reset).",
    properties: {
      state: {
        type: "string",
        enum: ["PRESENT"],
      },
      revision: {
        type: "integer",
        format: "int64",
        minimum: 1,
        description:
          "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
      },
      items: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "entityType",
            "entityId",
            "note",
            "pinned",
            "position",
            "groupId",
            "memberPosition",
            "revision",
            "lineage",
            "presentation",
            "removedAt",
            "updatedAt",
            "goalTrackedWorkFilter",
            "goalCollapsed",
          ],
          properties: {
            goalTrackedWorkFilter: {
              type: "string",
              enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
              default: "ACTIVE_AND_BACKLOG",
              description:
                "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
            },
            goalCollapsed: {
              type: "boolean",
              description:
                "Persisted Goal row disclosure; true means collapsed.",
            },
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
            note: {
              anyOf: [
                {
                  type: "string",
                  maxLength: 2000,
                  description: "Why-open note. Null or empty clears the note.",
                },
                {
                  type: "null",
                },
              ],
            },
            pinned: {
              type: "boolean",
            },
            position: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[0-9A-Za-z]+$",
              description:
                "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
            },
            groupId: {
              anyOf: [
                {
                  allOf: [
                    {
                      type: "string",
                      format: "uuid",
                      description:
                        "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                    },
                  ],
                  description: "Virtual group membership; null when ungrouped.",
                },
                {
                  type: "null",
                },
              ],
            },
            memberPosition: {
              anyOf: [
                {
                  allOf: [
                    {
                      type: "string",
                      minLength: 1,
                      maxLength: 64,
                      pattern: "^[0-9A-Za-z]+$",
                      description:
                        "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                    },
                  ],
                  description:
                    "Order within the group; null exactly when groupId is null.",
                },
                {
                  type: "null",
                },
              ],
            },
            revision: {
              type: "integer",
              format: "int64",
              minimum: 1,
              description:
                "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
            },
            lineage: {
              type: "array",
              maxItems: 16,
              description:
                "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["entityType", "entityId"],
                description:
                  "One route-owned ancestor of an Open Item, nearest-root first.",
                properties: {
                  entityType: {
                    type: "string",
                    enum: [
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
                      "USER",
                    ],
                    description:
                      "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                  },
                  entityId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            },
            presentation: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              description:
                "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
              properties: {
                label: {
                  type: "string",
                  minLength: 1,
                  maxLength: 300,
                },
                workItemTypeKey: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Registry work-item type key for registry-backed icons (work items only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                agentSessionType: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Agent Session type discriminator (agent sessions only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                routeParams: {
                  anyOf: [
                    {
                      type: "object",
                      maxProperties: 4,
                      additionalProperties: {
                        type: "string",
                        maxLength: 128,
                      },
                      description:
                        "Specialized canonical-destination route fields beyond entity identity.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
              },
            },
            removedAt: {
              anyOf: [
                {
                  type: "string",
                  format: "date-time",
                  description:
                    "Removal metadata. Non-null only in mutation results that removed the item; reads return open items only.",
                },
                {
                  type: "null",
                },
              ],
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
      groups: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "groupId",
            "name",
            "position",
            "collapsed",
            "revision",
            "updatedAt",
          ],
          properties: {
            groupId: {
              type: "string",
              format: "uuid",
              description:
                "Stable server-assigned virtual-group identity. Groups reference no project topology.",
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              description:
                "Display name of a virtual group (trimmed, non-blank).",
            },
            position: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[0-9A-Za-z]+$",
              description:
                "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
            },
            collapsed: {
              type: "boolean",
            },
            revision: {
              type: "integer",
              format: "int64",
              minimum: 1,
              description:
                "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
    },
  },
  OpenItemsCollection: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["state"],
        description:
          "No collection exists for this user and project; migration is permitted.",
        properties: {
          state: {
            type: "string",
            enum: ["ABSENT"],
          },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["state", "revision", "items", "groups"],
        description:
          "Canonical collection. Empty arrays mean an intentionally empty collection (for example after reset).",
        properties: {
          state: {
            type: "string",
            enum: ["PRESENT"],
          },
          revision: {
            type: "integer",
            format: "int64",
            minimum: 1,
            description:
              "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
          },
          items: {
            type: "array",
            maxItems: 1000,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "entityType",
                "entityId",
                "note",
                "pinned",
                "position",
                "groupId",
                "memberPosition",
                "revision",
                "lineage",
                "presentation",
                "removedAt",
                "updatedAt",
                "goalTrackedWorkFilter",
                "goalCollapsed",
              ],
              properties: {
                goalTrackedWorkFilter: {
                  type: "string",
                  enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
                  default: "ACTIVE_AND_BACKLOG",
                  description:
                    "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
                },
                goalCollapsed: {
                  type: "boolean",
                  description:
                    "Persisted Goal row disclosure; true means collapsed.",
                },
                entityType: {
                  type: "string",
                  enum: [
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
                    "USER",
                  ],
                  description:
                    "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                },
                entityId: {
                  type: "string",
                  format: "uuid",
                },
                note: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 2000,
                      description:
                        "Why-open note. Null or empty clears the note.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                pinned: {
                  type: "boolean",
                },
                position: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  pattern: "^[0-9A-Za-z]+$",
                  description:
                    "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                },
                groupId: {
                  anyOf: [
                    {
                      allOf: [
                        {
                          type: "string",
                          format: "uuid",
                          description:
                            "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                        },
                      ],
                      description:
                        "Virtual group membership; null when ungrouped.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                memberPosition: {
                  anyOf: [
                    {
                      allOf: [
                        {
                          type: "string",
                          minLength: 1,
                          maxLength: 64,
                          pattern: "^[0-9A-Za-z]+$",
                          description:
                            "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                        },
                      ],
                      description:
                        "Order within the group; null exactly when groupId is null.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                revision: {
                  type: "integer",
                  format: "int64",
                  minimum: 1,
                  description:
                    "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
                },
                lineage: {
                  type: "array",
                  maxItems: 16,
                  description:
                    "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["entityType", "entityId"],
                    description:
                      "One route-owned ancestor of an Open Item, nearest-root first.",
                    properties: {
                      entityType: {
                        type: "string",
                        enum: [
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
                          "USER",
                        ],
                        description:
                          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                      },
                      entityId: {
                        type: "string",
                        format: "uuid",
                      },
                    },
                  },
                },
                presentation: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label"],
                  description:
                    "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
                  properties: {
                    label: {
                      type: "string",
                      minLength: 1,
                      maxLength: 300,
                    },
                    workItemTypeKey: {
                      anyOf: [
                        {
                          type: "string",
                          maxLength: 64,
                          description:
                            "Registry work-item type key for registry-backed icons (work items only).",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                    agentSessionType: {
                      anyOf: [
                        {
                          type: "string",
                          maxLength: 64,
                          description:
                            "Agent Session type discriminator (agent sessions only).",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                    routeParams: {
                      anyOf: [
                        {
                          type: "object",
                          maxProperties: 4,
                          additionalProperties: {
                            type: "string",
                            maxLength: 128,
                          },
                          description:
                            "Specialized canonical-destination route fields beyond entity identity.",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                  },
                },
                removedAt: {
                  anyOf: [
                    {
                      type: "string",
                      format: "date-time",
                      description:
                        "Removal metadata. Non-null only in mutation results that removed the item; reads return open items only.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                updatedAt: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
          groups: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "groupId",
                "name",
                "position",
                "collapsed",
                "revision",
                "updatedAt",
              ],
              properties: {
                groupId: {
                  type: "string",
                  format: "uuid",
                  description:
                    "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                },
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                  description:
                    "Display name of a virtual group (trimmed, non-blank).",
                },
                position: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  pattern: "^[0-9A-Za-z]+$",
                  description:
                    "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                },
                collapsed: {
                  type: "boolean",
                },
                revision: {
                  type: "integer",
                  format: "int64",
                  minimum: 1,
                  description:
                    "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
                },
                updatedAt: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
        },
      },
    ],
  },
  OpenItemsMutationResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "collectionRevision",
      "items",
      "groups",
      "deletedGroupIds",
      "replayed",
    ],
    description:
      "Canonical post-mutation state. Lists every affected item and group, including server-derived descendant and membership effects, not an echo of the request.",
    properties: {
      collectionRevision: {
        type: "integer",
        format: "int64",
        minimum: 1,
        description:
          "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
      },
      items: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "entityType",
            "entityId",
            "note",
            "pinned",
            "position",
            "groupId",
            "memberPosition",
            "revision",
            "lineage",
            "presentation",
            "removedAt",
            "updatedAt",
            "goalTrackedWorkFilter",
            "goalCollapsed",
          ],
          properties: {
            goalTrackedWorkFilter: {
              type: "string",
              enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
              default: "ACTIVE_AND_BACKLOG",
              description:
                "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
            },
            goalCollapsed: {
              type: "boolean",
              description:
                "Persisted Goal row disclosure; true means collapsed.",
            },
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
            note: {
              anyOf: [
                {
                  type: "string",
                  maxLength: 2000,
                  description: "Why-open note. Null or empty clears the note.",
                },
                {
                  type: "null",
                },
              ],
            },
            pinned: {
              type: "boolean",
            },
            position: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[0-9A-Za-z]+$",
              description:
                "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
            },
            groupId: {
              anyOf: [
                {
                  allOf: [
                    {
                      type: "string",
                      format: "uuid",
                      description:
                        "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                    },
                  ],
                  description: "Virtual group membership; null when ungrouped.",
                },
                {
                  type: "null",
                },
              ],
            },
            memberPosition: {
              anyOf: [
                {
                  allOf: [
                    {
                      type: "string",
                      minLength: 1,
                      maxLength: 64,
                      pattern: "^[0-9A-Za-z]+$",
                      description:
                        "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                    },
                  ],
                  description:
                    "Order within the group; null exactly when groupId is null.",
                },
                {
                  type: "null",
                },
              ],
            },
            revision: {
              type: "integer",
              format: "int64",
              minimum: 1,
              description:
                "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
            },
            lineage: {
              type: "array",
              maxItems: 16,
              description:
                "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["entityType", "entityId"],
                description:
                  "One route-owned ancestor of an Open Item, nearest-root first.",
                properties: {
                  entityType: {
                    type: "string",
                    enum: [
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
                      "USER",
                    ],
                    description:
                      "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                  },
                  entityId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            },
            presentation: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              description:
                "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
              properties: {
                label: {
                  type: "string",
                  minLength: 1,
                  maxLength: 300,
                },
                workItemTypeKey: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Registry work-item type key for registry-backed icons (work items only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                agentSessionType: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Agent Session type discriminator (agent sessions only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                routeParams: {
                  anyOf: [
                    {
                      type: "object",
                      maxProperties: 4,
                      additionalProperties: {
                        type: "string",
                        maxLength: 128,
                      },
                      description:
                        "Specialized canonical-destination route fields beyond entity identity.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
              },
            },
            removedAt: {
              anyOf: [
                {
                  type: "string",
                  format: "date-time",
                  description:
                    "Removal metadata. Non-null only in mutation results that removed the item; reads return open items only.",
                },
                {
                  type: "null",
                },
              ],
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
      groups: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "groupId",
            "name",
            "position",
            "collapsed",
            "revision",
            "updatedAt",
          ],
          properties: {
            groupId: {
              type: "string",
              format: "uuid",
              description:
                "Stable server-assigned virtual-group identity. Groups reference no project topology.",
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              description:
                "Display name of a virtual group (trimmed, non-blank).",
            },
            position: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[0-9A-Za-z]+$",
              description:
                "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
            },
            collapsed: {
              type: "boolean",
            },
            revision: {
              type: "integer",
              format: "int64",
              minimum: 1,
              description:
                "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
      deletedGroupIds: {
        type: "array",
        maxItems: 1,
        items: {
          type: "string",
          format: "uuid",
          description:
            "Stable server-assigned virtual-group identity. Groups reference no project topology.",
        },
      },
      replayed: {
        type: "boolean",
        description:
          "True when this result was returned from the idempotency record of an earlier identical request.",
      },
    },
  },
  ActivateOpenItemRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "item", "lineage", "presentation"],
    description:
      "New or reopened entries inherit the nearest already-open ancestor's canonical group from root-to-parent lineage, with a server-assigned member position. A nearer ungrouped ancestor stops inheritance. Already-live entries preserve explicit membership, including explicit ungrouping.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      item: {
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId"],
        description:
          "Canonical identity; intent applies to current server state.",
        properties: {
          entityType: {
            type: "string",
            enum: [
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
              "USER",
            ],
            description:
              "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
          },
          entityId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      lineage: {
        type: "array",
        maxItems: 16,
        description:
          "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "One route-owned ancestor of an Open Item, nearest-root first.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      presentation: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        description:
          "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 300,
          },
          workItemTypeKey: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Registry work-item type key for registry-backed icons (work items only).",
              },
              {
                type: "null",
              },
            ],
          },
          agentSessionType: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Agent Session type discriminator (agent sessions only).",
              },
              {
                type: "null",
              },
            ],
          },
          routeParams: {
            anyOf: [
              {
                type: "object",
                maxProperties: 4,
                additionalProperties: {
                  type: "string",
                  maxLength: 128,
                },
                description:
                  "Specialized canonical-destination route fields beyond entity identity.",
              },
              {
                type: "null",
              },
            ],
          },
        },
      },
    },
  },
  SetOpenItemNoteRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "note"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      note: {
        anyOf: [
          {
            type: "string",
            maxLength: 2000,
            description: "Why-open note. Null or empty clears the note.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  SetOpenItemPinRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "pinned"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      pinned: {
        type: "boolean",
      },
    },
  },
  MoveOpenItemRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "after"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      after: {
        anyOf: [
          {
            allOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["entityType", "entityId"],
                description:
                  "Canonical entity identity of an Open Item, unique within a collection.",
                properties: {
                  entityType: {
                    type: "string",
                    enum: [
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
                      "USER",
                    ],
                    description:
                      "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                  },
                  entityId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            ],
            description:
              "Item to place the moved item after; null places it first.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  RemoveOpenItemRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "includeDescendants"],
    description:
      "Removes the item. When includeDescendants is true the server also removes unpinned open nested descendants derived from stored lineage whose group is null or matches the selected item's non-null group. Pinned descendants and descendants in a different group are retained. Direct removal removes the selected item regardless of pin or membership. Every affected canonical row is returned.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      includeDescendants: {
        type: "boolean",
      },
    },
  },
  RemoveOpenItemsRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "includeDescendants", "items"],
    description:
      "Removes each targeted item using the same stored-lineage, pin, and virtual-group descendant rules as single-item removal. Every affected canonical row is returned.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      includeDescendants: {
        type: "boolean",
      },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "Canonical identity; intent applies to current server state.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
    },
  },
  CreateOpenItemGroupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "name"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Display name of a virtual group (trimmed, non-blank).",
      },
      collapsed: {
        type: "boolean",
        default: false,
      },
      assign: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        description:
          "Optional items to assign to the new group in the same transaction (open nested descendants follow).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "Canonical identity; intent applies to current server state.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
    },
  },
  RenameOpenItemGroupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "name"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Display name of a virtual group (trimmed, non-blank).",
      },
    },
  },
  DeleteOpenItemGroupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey"],
    description:
      "Deletes the group and ungroups every member without removing it from Open Items.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
    },
  },
  SetOpenItemGroupDisclosureRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "collapsed"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      collapsed: {
        type: "boolean",
      },
    },
  },
  MoveOpenItemGroupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "afterGroupId"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      afterGroupId: {
        anyOf: [
          {
            allOf: [
              {
                type: "string",
                format: "uuid",
                description:
                  "Stable server-assigned virtual-group identity. Groups reference no project topology.",
              },
            ],
            description:
              "Group to place the moved group after; null places it first.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  AssignOpenItemsToGroupRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "items"],
    description:
      "Assigns one row or an Open Items-owned selection to the group, replacing prior membership. The server also assigns every currently open nested descendant.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "Canonical identity; intent applies to current server state.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
    },
  },
  UngroupOpenItemsRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "items"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "Canonical identity; intent applies to current server state.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
    },
  },
  MoveOpenItemGroupMemberRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "after"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      after: {
        anyOf: [
          {
            allOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["entityType", "entityId"],
                description:
                  "Canonical entity identity of an Open Item, unique within a collection.",
                properties: {
                  entityType: {
                    type: "string",
                    enum: [
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
                      "USER",
                    ],
                    description:
                      "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                  },
                  entityId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            ],
            description:
              "Member of the same group to place the item after; null places it first in the group.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  MigrateOpenItemsGroup: {
    type: "object",
    additionalProperties: false,
    required: ["localGroupId", "name", "collapsed"],
    description: "Browser-local group definition. Array order is group order.",
    properties: {
      localGroupId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        description:
          "Browser-local group identity, used only to resolve item membership within this request.",
      },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Display name of a virtual group (trimmed, non-blank).",
      },
      collapsed: {
        type: "boolean",
      },
    },
  },
  MigrateOpenItemsItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "entityType",
      "entityId",
      "note",
      "pinned",
      "localGroupId",
      "lineage",
      "presentation",
    ],
    description:
      "Browser-local item. Array order is collection order; within a group, relative array order is member order.",
    properties: {
      entityType: {
        type: "string",
        enum: [
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
          "USER",
        ],
        description:
          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
      },
      entityId: {
        type: "string",
        format: "uuid",
      },
      note: {
        anyOf: [
          {
            type: "string",
            maxLength: 2000,
            description: "Why-open note. Null or empty clears the note.",
          },
          {
            type: "null",
          },
        ],
      },
      pinned: {
        type: "boolean",
      },
      localGroupId: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
          {
            type: "null",
          },
        ],
      },
      lineage: {
        type: "array",
        maxItems: 16,
        description:
          "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "One route-owned ancestor of an Open Item, nearest-root first.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      presentation: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        description:
          "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 300,
          },
          workItemTypeKey: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Registry work-item type key for registry-backed icons (work items only).",
              },
              {
                type: "null",
              },
            ],
          },
          agentSessionType: {
            anyOf: [
              {
                type: "string",
                maxLength: 64,
                description:
                  "Agent Session type discriminator (agent sessions only).",
              },
              {
                type: "null",
              },
            ],
          },
          routeParams: {
            anyOf: [
              {
                type: "object",
                maxProperties: 4,
                additionalProperties: {
                  type: "string",
                  maxLength: 128,
                },
                description:
                  "Specialized canonical-destination route fields beyond entity identity.",
              },
              {
                type: "null",
              },
            ],
          },
        },
      },
    },
  },
  MigrateOpenItemsRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "sourceSchemaVersion", "items", "groups"],
    description:
      "One-time import of the validated versioned browser-local record. Accepted only when the collection is ABSENT; items and group state are imported atomically.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      sourceSchemaVersion: {
        type: "integer",
        minimum: 1,
        description:
          "Version of the browser-local Open Items record the payload was read from.",
      },
      items: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "entityType",
            "entityId",
            "note",
            "pinned",
            "localGroupId",
            "lineage",
            "presentation",
          ],
          description:
            "Browser-local item. Array order is collection order; within a group, relative array order is member order.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
            note: {
              anyOf: [
                {
                  type: "string",
                  maxLength: 2000,
                  description: "Why-open note. Null or empty clears the note.",
                },
                {
                  type: "null",
                },
              ],
            },
            pinned: {
              type: "boolean",
            },
            localGroupId: {
              anyOf: [
                {
                  type: "string",
                  minLength: 1,
                  maxLength: 128,
                },
                {
                  type: "null",
                },
              ],
            },
            lineage: {
              type: "array",
              maxItems: 16,
              description:
                "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["entityType", "entityId"],
                description:
                  "One route-owned ancestor of an Open Item, nearest-root first.",
                properties: {
                  entityType: {
                    type: "string",
                    enum: [
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
                      "USER",
                    ],
                    description:
                      "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                  },
                  entityId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            },
            presentation: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              description:
                "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
              properties: {
                label: {
                  type: "string",
                  minLength: 1,
                  maxLength: 300,
                },
                workItemTypeKey: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Registry work-item type key for registry-backed icons (work items only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                agentSessionType: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 64,
                      description:
                        "Agent Session type discriminator (agent sessions only).",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                routeParams: {
                  anyOf: [
                    {
                      type: "object",
                      maxProperties: 4,
                      additionalProperties: {
                        type: "string",
                        maxLength: 128,
                      },
                      description:
                        "Specialized canonical-destination route fields beyond entity identity.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
              },
            },
          },
        },
      },
      groups: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["localGroupId", "name", "collapsed"],
          description:
            "Browser-local group definition. Array order is group order.",
          properties: {
            localGroupId: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              description:
                "Browser-local group identity, used only to resolve item membership within this request.",
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              description:
                "Display name of a virtual group (trimmed, non-blank).",
            },
            collapsed: {
              type: "boolean",
            },
          },
        },
      },
    },
  },
  ResetOpenItemsRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey"],
    description:
      "Clears all items and virtual-group state, leaving an intentionally empty PRESENT collection. Does not affect Recently Viewed or User Settings.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
    },
  },
  OpenItemsValidationError: {
    type: "object",
    additionalProperties: false,
    required: ["success", "code", "message", "violations"],
    properties: {
      success: {
        type: "boolean",
        enum: [false],
      },
      code: {
        type: "string",
        enum: [
          "INVALID_REQUEST",
          "ITEM_NOT_OPEN",
          "GROUP_NOT_FOUND",
          "INVALID_PLACEMENT",
          "INVALID_MIGRATION_MEMBERSHIP",
          "COLLECTION_LIMIT_EXCEEDED",
        ],
      },
      message: {
        type: "string",
      },
      violations: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "message"],
          properties: {
            path: {
              type: "string",
              maxLength: 256,
              description: "JSON pointer into the request body.",
            },
            message: {
              type: "string",
              maxLength: 500,
            },
          },
        },
      },
    },
  },
  OpenItemsConflictError: {
    type: "object",
    additionalProperties: false,
    required: ["success", "code", "message", "currentCollectionRevision"],
    properties: {
      success: {
        type: "boolean",
        enum: [false],
      },
      code: {
        type: "string",
        enum: [
          "COLLECTION_ALREADY_EXISTS",
          "COLLECTION_ABSENT",
          "IDEMPOTENCY_KEY_REUSED",
        ],
      },
      message: {
        type: "string",
      },
      currentCollectionRevision: {
        anyOf: [
          {
            allOf: [
              {
                type: "integer",
                format: "int64",
                minimum: 1,
                description:
                  "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
              },
            ],
            description:
              "Current canonical collection revision; null when the collection is absent. Clients re-read before retrying.",
          },
          {
            type: "null",
          },
        ],
      },
    },
  },
  OpenItemsTriageSession: {
    type: "object",
    additionalProperties: false,
    required: ["agentSessionId", "conversationId", "created"],
    description:
      "The authenticated user's single Open Items triage Agent Session in the project and its Conversation.",
    properties: {
      agentSessionId: {
        type: "string",
        format: "uuid",
        description: "AGENT_SESSION identity.",
      },
      conversationId: {
        type: "string",
        format: "uuid",
        description: "CONVERSATION identity bound to the Agent Session.",
      },
      created: {
        type: "boolean",
        description:
          "True only for the request that created the Agent Session.",
      },
    },
  },
  OpenItemGoalTrackedWorkFilter: {
    type: "string",
    enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
    default: "ACTIVE_AND_BACKLOG",
    description:
      "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
  },
  SetOpenItemGoalFilterRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "filter"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      filter: {
        type: "string",
        enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
        default: "ACTIVE_AND_BACKLOG",
        description:
          "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
      },
    },
  },
  SetOpenItemGoalDisclosureRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "collapsed"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      collapsed: {
        type: "boolean",
      },
    },
  },
  PromoteGroupToGoalRequest: {
    type: "object",
    additionalProperties: false,
    required: ["idempotencyKey", "groupId", "goalName"],
    description:
      "Ordered promotion against current state; no expected-revision input. A missing group is rejected before Goal creation. Earlier Goal/TRACKS writes remain after later failure while the collection stays unchanged. Same-intent retries reuse the Goal and existing TRACKS writes.",
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Client-generated key. Retrying the same key with the same request returns the originally recorded result; reusing it with a different request is a conflict.",
      },
      groupId: {
        type: "string",
        format: "uuid",
        description:
          "Stable server-assigned virtual-group identity. Groups reference no project topology.",
      },
      goalName: {
        type: "string",
        minLength: 1,
        maxLength: 300,
        pattern: "\\S",
      },
      targetDate: {
        type: "string",
        format: "date-time",
      },
    },
  },
  PromoteGroupToGoalResult: {
    type: "object",
    additionalProperties: false,
    required: ["collection", "goal", "untrackedMembers", "replayed"],
    properties: {
      collection: {
        type: "object",
        additionalProperties: false,
        required: ["state", "revision", "items", "groups"],
        description:
          "Canonical collection. Empty arrays mean an intentionally empty collection (for example after reset).",
        properties: {
          state: {
            type: "string",
            enum: ["PRESENT"],
          },
          revision: {
            type: "integer",
            format: "int64",
            minimum: 1,
            description:
              "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
          },
          items: {
            type: "array",
            maxItems: 1000,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "entityType",
                "entityId",
                "note",
                "pinned",
                "position",
                "groupId",
                "memberPosition",
                "revision",
                "lineage",
                "presentation",
                "removedAt",
                "updatedAt",
                "goalTrackedWorkFilter",
                "goalCollapsed",
              ],
              properties: {
                goalTrackedWorkFilter: {
                  type: "string",
                  enum: ["ACTIVE_AND_BACKLOG", "ACTIVE", "ALL", "NONE"],
                  default: "ACTIVE_AND_BACKLOG",
                  description:
                    "Goal row tracked-work display filter. ACTIVE includes ACTIVE work or a canonical non-IDLE running Agent Session. Tracked work is loaded only when expanded.",
                },
                goalCollapsed: {
                  type: "boolean",
                  description:
                    "Persisted Goal row disclosure; true means collapsed.",
                },
                entityType: {
                  type: "string",
                  enum: [
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
                    "USER",
                  ],
                  description:
                    "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                },
                entityId: {
                  type: "string",
                  format: "uuid",
                },
                note: {
                  anyOf: [
                    {
                      type: "string",
                      maxLength: 2000,
                      description:
                        "Why-open note. Null or empty clears the note.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                pinned: {
                  type: "boolean",
                },
                position: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  pattern: "^[0-9A-Za-z]+$",
                  description:
                    "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                },
                groupId: {
                  anyOf: [
                    {
                      allOf: [
                        {
                          type: "string",
                          format: "uuid",
                          description:
                            "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                        },
                      ],
                      description:
                        "Virtual group membership; null when ungrouped.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                memberPosition: {
                  anyOf: [
                    {
                      allOf: [
                        {
                          type: "string",
                          minLength: 1,
                          maxLength: 64,
                          pattern: "^[0-9A-Za-z]+$",
                          description:
                            "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                        },
                      ],
                      description:
                        "Order within the group; null exactly when groupId is null.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                revision: {
                  type: "integer",
                  format: "int64",
                  minimum: 1,
                  description:
                    "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
                },
                lineage: {
                  type: "array",
                  maxItems: 16,
                  description:
                    "Bounded route-owned lineage snapshot ordered root to immediate parent. Used by the server to derive open nested descendants.",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["entityType", "entityId"],
                    description:
                      "One route-owned ancestor of an Open Item, nearest-root first.",
                    properties: {
                      entityType: {
                        type: "string",
                        enum: [
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
                          "USER",
                        ],
                        description:
                          "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
                      },
                      entityId: {
                        type: "string",
                        format: "uuid",
                      },
                    },
                  },
                },
                presentation: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label"],
                  description:
                    "Bounded stable page-owned presentation snapshot sufficient to render a base row without entity hydration. Contains no live or transient state.",
                  properties: {
                    label: {
                      type: "string",
                      minLength: 1,
                      maxLength: 300,
                    },
                    workItemTypeKey: {
                      anyOf: [
                        {
                          type: "string",
                          maxLength: 64,
                          description:
                            "Registry work-item type key for registry-backed icons (work items only).",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                    agentSessionType: {
                      anyOf: [
                        {
                          type: "string",
                          maxLength: 64,
                          description:
                            "Agent Session type discriminator (agent sessions only).",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                    routeParams: {
                      anyOf: [
                        {
                          type: "object",
                          maxProperties: 4,
                          additionalProperties: {
                            type: "string",
                            maxLength: 128,
                          },
                          description:
                            "Specialized canonical-destination route fields beyond entity identity.",
                        },
                        {
                          type: "null",
                        },
                      ],
                    },
                  },
                },
                removedAt: {
                  anyOf: [
                    {
                      type: "string",
                      format: "date-time",
                      description:
                        "Removal metadata. Non-null only in mutation results that removed the item; reads return open items only.",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                updatedAt: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
          groups: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "groupId",
                "name",
                "position",
                "collapsed",
                "revision",
                "updatedAt",
              ],
              properties: {
                groupId: {
                  type: "string",
                  format: "uuid",
                  description:
                    "Stable server-assigned virtual-group identity. Groups reference no project topology.",
                },
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                  description:
                    "Display name of a virtual group (trimmed, non-blank).",
                },
                position: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  pattern: "^[0-9A-Za-z]+$",
                  description:
                    "Server-assigned sortable key. Ascending lexicographic order is presentation order; moves rewrite only the moved row.",
                },
                collapsed: {
                  type: "boolean",
                },
                revision: {
                  type: "integer",
                  format: "int64",
                  minimum: 1,
                  description:
                    "Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.",
                },
                updatedAt: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
        },
      },
      goal: {
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId"],
        description:
          "Canonical entity identity of an Open Item, unique within a collection.",
        properties: {
          entityType: {
            type: "string",
            enum: [
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
              "USER",
            ],
            description:
              "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
          },
          entityId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      untrackedMembers: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "entityId"],
          description:
            "Canonical entity identity of an Open Item, unique within a collection.",
          properties: {
            entityType: {
              type: "string",
              enum: [
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
                "USER",
              ],
              description:
                "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
            },
            entityId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      replayed: {
        type: "boolean",
      },
    },
  },
} as const;
