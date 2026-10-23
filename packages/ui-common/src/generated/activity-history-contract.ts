// Generated from OpenAPI by scripts/generate-activity-history-contract.cjs.
export const activityHistoryFilterSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "metric",
    "projectIds",
    "windowStart",
    "windowEnd"
  ],
  "description": "Editable metric history uses accepted-evidence classification and deduplication.\nProjects are explicit authorized scope; an empty array returns no records and inaccessible projects are rejected.\nOccurrence bounds are inclusive start and exclusive end, with start before end.\nuserId selects the persisted event actor before deduplication and pagination, never current assignment.\nOmitted userId includes all actors. PERSONAL continuation and Home aggregate semantics are unchanged.\n",
  "properties": {
    "metric": {
      "type": "string",
      "enum": [
        "TASK_CREATED",
        "TASK_COMPLETED",
        "TASK_VERIFYING",
        "BUG_CREATED",
        "BUG_COMPLETED",
        "BUG_VERIFYING",
        "PLAN_CREATED",
        "PLAN_COMPLETED",
        "PLAN_VERIFYING",
        "AGENT_SESSION_CREATED",
        "PROJECT_INFO_CREATED",
        "PROJECT_INFO_UPDATED"
      ],
      "description": "Closed identity for a rolling project metric. Project Info\ncreation and update are distinct identities; a creation is never also an\nupdate. Personal scope omits both Project Info identities; classification\notherwise remains project-registry owned in every actor scope.\n"
    },
    "projectIds": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "branded-ProjectId",
        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        "description": "Unique identifier for a project (branded type)",
        "example": "550e8400-e29b-41d4-a716-446655440000",
        "x-typescript-type": "ProjectId",
        "x-brand": "ProjectId",
        "x-semantic-type": "resource-identifier"
      }
    },
    "windowStart": {
      "type": "string",
      "format": "date-time"
    },
    "windowEnd": {
      "type": "string",
      "format": "date-time"
    },
    "userId": {
      "type": "string",
      "format": "branded-UserId",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "description": "Unique identifier for a user (branded type)",
      "example": "550e8400-e29b-41d4-a716-446655440001",
      "x-typescript-type": "UserId",
      "x-brand": "UserId",
      "x-semantic-type": "resource-identifier"
    }
  }
} as const;
