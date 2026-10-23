// Generated from OpenAPI by scripts/generate-browser-session-contract.cjs.
export const browserSessionSchema = {
  "description": "Establishes or atomically rotates cookie-only refresh continuity. Confirmed access has matching token and user organization IDs. Fresh sign-in restores an authorized saved organization, or selects the sole accessible organization when no choice is saved. Multiple accessible organizations without a saved choice return selection_required. Unauthorized stored or requested choices return selection_denied without selecting another membership. Selection outcomes persist null choice, clear prior access, and preserve browser identity.",
  "oneOf": [
    {
      "type": "object",
      "description": "Browser authentication response. Refresh continuity is maintained by HttpOnly cookies and is never returned in JSON. The user's currentOrganizationId is non-null and matches the confirmed organization in the access token.",
      "required": [
        "user",
        "accessToken",
        "expiresIn"
      ],
      "properties": {
        "user": {
          "type": "object",
          "required": [
            "id",
            "email",
            "name",
            "isActive",
            "createdAt",
            "updatedAt"
          ],
          "properties": {
            "id": {
              "type": "string",
              "format": "branded-UserId",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "description": "Unique identifier for a user (branded type)",
              "example": "550e8400-e29b-41d4-a716-446655440001",
              "x-typescript-type": "UserId",
              "x-brand": "UserId",
              "x-semantic-type": "resource-identifier"
            },
            "email": {
              "type": "string",
              "format": "email",
              "description": "User's email address"
            },
            "name": {
              "type": "string",
              "description": "User's full name"
            },
            "isActive": {
              "type": "boolean",
              "description": "Whether the user account is active"
            },
            "lastLoginAt": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time",
                  "description": "Last login timestamp"
                },
                {
                  "type": "null"
                }
              ]
            },
            "createdAt": {
              "type": "string",
              "format": "date-time",
              "description": "Creation timestamp"
            },
            "updatedAt": {
              "type": "string",
              "format": "date-time",
              "description": "Last update timestamp"
            },
            "currentOrganizationId": {
              "anyOf": [
                {
                  "allOf": [
                    {
                      "type": "string",
                      "format": "branded-OrganizationId",
                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                      "description": "Unique identifier for an organization (branded type)",
                      "example": "550e8400-e29b-41d4-a716-446655440002",
                      "x-typescript-type": "OrganizationId",
                      "x-brand": "OrganizationId",
                      "x-semantic-type": "resource-identifier"
                    }
                  ]
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "accessToken": {
          "type": "string",
          "description": "Short-lived JWT access token for browser authorization"
        },
        "expiresIn": {
          "type": "integer",
          "description": "Access-token expiration time in seconds"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "additionalProperties": false,
      "description": "Authenticated browser identity requiring explicit organization selection. No access token is issued and user.currentOrganizationId is null. Choices are informational; an explicit request reauthorizes current access.",
      "required": [
        "status",
        "user",
        "organizations"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "selection_required",
            "selection_denied"
          ]
        },
        "user": {
          "type": "object",
          "required": [
            "id",
            "email",
            "name",
            "isActive",
            "createdAt",
            "updatedAt"
          ],
          "properties": {
            "id": {
              "type": "string",
              "format": "branded-UserId",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "description": "Unique identifier for a user (branded type)",
              "example": "550e8400-e29b-41d4-a716-446655440001",
              "x-typescript-type": "UserId",
              "x-brand": "UserId",
              "x-semantic-type": "resource-identifier"
            },
            "email": {
              "type": "string",
              "format": "email",
              "description": "User's email address"
            },
            "name": {
              "type": "string",
              "description": "User's full name"
            },
            "isActive": {
              "type": "boolean",
              "description": "Whether the user account is active"
            },
            "lastLoginAt": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "date-time",
                  "description": "Last login timestamp"
                },
                {
                  "type": "null"
                }
              ]
            },
            "createdAt": {
              "type": "string",
              "format": "date-time",
              "description": "Creation timestamp"
            },
            "updatedAt": {
              "type": "string",
              "format": "date-time",
              "description": "Last update timestamp"
            },
            "currentOrganizationId": {
              "anyOf": [
                {
                  "allOf": [
                    {
                      "type": "string",
                      "format": "branded-OrganizationId",
                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                      "description": "Unique identifier for an organization (branded type)",
                      "example": "550e8400-e29b-41d4-a716-446655440002",
                      "x-typescript-type": "OrganizationId",
                      "x-brand": "OrganizationId",
                      "x-semantic-type": "resource-identifier"
                    }
                  ]
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "organizations": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id",
              "name"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "name": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  ]
} as const;
export const accountDefaultOrganizationSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "organizationId"
  ],
  "properties": {
    "organizationId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "description": "Explicit account preference; null means no saved choice. Never substitutes for an existing browser session selection."
        },
        {
          "type": "null"
        }
      ]
    }
  }
} as const;
