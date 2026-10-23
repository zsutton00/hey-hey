/* This file is generated from OpenAPI by scripts/project-mode-contract.js. */
/* eslint-disable @typescript-eslint/no-unused-vars */

/* Do not edit by hand. */

export const projectModeFilesJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "files"
  ],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": [
        "project-mode-files.v1"
      ],
      "description": "Version of the project MODE file-bundle schema."
    },
    "files": {
      "type": "object",
      "minProperties": 1,
      "required": [
        "MODE.md"
      ],
      "propertyNames": {
        "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"
      },
      "properties": {
        "MODE.md": {
          "type": "string",
          "minLength": 1,
          "description": "Required entry instructions for the selected project MODE."
        }
      },
      "additionalProperties": {
        "type": "string"
      },
      "description": "Text files keyed by safe relative POSIX paths. `MODE.md` is the required\nentry document; supporting files remain available for on-demand reads.\n"
    }
  },
  "description": "Closed, versioned value stored in a MODE work item's schema-backed `files`\nsection. File paths are relative and file values are text; the bundle does\nnot carry executable hooks, tool grants, or provider configuration.\n"
} as const;

export const projectModeSettingsJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "projectAssistant"
  ],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": [
        "project-mode-settings.v1"
      ],
      "description": "Version of the project MODE settings schema."
    },
    "projectAssistant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "enabled"
      ],
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Whether Project Assistant runs before the MODE's first turn."
        }
      },
      "description": "Project Assistant participation chosen by the MODE author. It is the\nproject-mode handler's participation baseline rather than a\nsession-configuration override, which is why it may turn participation on.\n"
    },
    "eligibleWorkItemTypeKeys": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "Stable effective work-item type keys this MODE may launch against,\nchosen per MODE. Keys must be unique (enforced by the platform\nvalidator rather than `uniqueItems`, which generators map to sets). Each key must resolve to an active type in the\nproject's effective registry snapshot. Launch eligibility is this list\nintersected with the MODE's Feature `DEPENDS_ON` scope. When absent, the\nMODE keeps its legacy eligibility derived from the shared MODE type's\nagent-guidance contexts; consumers must not widen access for an absent\nlist.\n"
    }
  },
  "description": "Closed, versioned value stored in a MODE work item's schema-backed\n`settings` section.\n"
} as const;

export const projectModeSelectionJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "modeId"
  ],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": [
        "project-mode-selection.v1"
      ]
    },
    "modeId": {
      "type": "string",
      "format": "uuid",
      "description": "Canonical work-item identity of the explicitly selected MODE."
    }
  },
  "description": "Stable identity of an explicitly selected project MODE. This is launch\nselection data, not a CLI prompt type or logical provider-session agent\nidentity.\n"
} as const;

export const projectModeSnapshotJsonSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "modeId",
    "catalogDescription",
    "applicableWorkItemTypeKeys",
    "files",
    "snapshotHash"
  ],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": [
        "project-mode-snapshot.v1",
        "project-mode-snapshot.v2"
      ],
      "description": "v2 adds `projectAssistant`. v1 is kept so snapshots captured before the\nsetting existed still verify against their original hash.\n"
    },
    "modeId": {
      "type": "string",
      "format": "uuid",
      "description": "MODE identity this immutable launch snapshot was captured from."
    },
    "catalogDescription": {
      "type": "string",
      "description": "Canonical catalog description captured when the session was created."
    },
    "applicableWorkItemTypeKeys": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "Stable effective work-item type keys the MODE applied to at capture time."
    },
    "files": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "files"
      ],
      "properties": {
        "schemaVersion": {
          "type": "string",
          "enum": [
            "project-mode-files.v1"
          ],
          "description": "Version of the project MODE file-bundle schema."
        },
        "files": {
          "type": "object",
          "minProperties": 1,
          "required": [
            "MODE.md"
          ],
          "propertyNames": {
            "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"
          },
          "properties": {
            "MODE.md": {
              "type": "string",
              "minLength": 1,
              "description": "Required entry instructions for the selected project MODE."
            }
          },
          "additionalProperties": {
            "type": "string"
          },
          "description": "Text files keyed by safe relative POSIX paths. `MODE.md` is the required\nentry document; supporting files remain available for on-demand reads.\n"
        }
      },
      "description": "Closed, versioned value stored in a MODE work item's schema-backed `files`\nsection. File paths are relative and file values are text; the bundle does\nnot carry executable hooks, tool grants, or provider configuration.\n"
    },
    "projectAssistant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "enabled"
      ],
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Whether Project Assistant runs before the MODE's first turn."
        }
      },
      "description": "Project Assistant participation chosen by the MODE author. It is the\nproject-mode handler's participation baseline rather than a\nsession-configuration override, which is why it may turn participation on.\n"
    },
    "snapshotHash": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "Lowercase hexadecimal SHA-256 digest of the platform-canonicalized\nsnapshot content. Consumers preserve and compare this value; they do\nnot refresh the snapshot from the live MODE.\n"
    }
  },
  "description": "Platform-captured immutable MODE configuration persisted with a coding\nsession. The repeated mode identity lets admission verify that the snapshot\nmatches `ProjectModeSelection` before constructing a Run or Turn.\n"
} as const;
