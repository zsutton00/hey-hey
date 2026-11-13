// Generated from OpenAPI. Do not edit.
export const approvalPolicySchema = {
  "definitions": {
    "ProposalApprovalExplanation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "evidence",
        "source",
        "conditions",
        "requirement",
        "changedFields",
        "changedFieldClassification",
        "creditedProposerApprovals",
        "viewerEligibility"
      ],
      "properties": {
        "evidence": {
          "$ref": "#/definitions/ProposalApprovalExplanationEvidence"
        },
        "source": {
          "anyOf": [
            {
              "allOf": [
                {
                  "$ref": "#/definitions/ProjectApprovalPolicyRuleSource"
                }
              ],
              "description": "Null only when historical evidence is UNAVAILABLE."
            },
            {
              "type": "null"
            }
          ]
        },
        "conditions": {
          "anyOf": [
            {
              "allOf": [
                {
                  "$ref": "#/definitions/ProjectApprovalPolicyEffectiveConditions"
                }
              ],
              "description": "Matched rule conditions; null only when historical evidence is UNAVAILABLE."
            },
            {
              "type": "null"
            }
          ]
        },
        "requirement": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "category",
                "requiredApprovals"
              ],
              "properties": {
                "category": {
                  "$ref": "#/definitions/ProjectApprovalPolicyRequirement"
                },
                "requiredApprovals": {
                  "type": "integer",
                  "format": "int32",
                  "minimum": 0,
                  "maximum": 2147483647
                }
              },
              "description": "Null only when historical evidence is UNAVAILABLE."
            },
            {
              "type": "null"
            }
          ]
        },
        "changedFields": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "API-classified field paths for the proposal. Null only when historical evidence is UNAVAILABLE; an empty array means no content fields."
            },
            {
              "type": "null"
            }
          ]
        },
        "changedFieldClassification": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "statusOnlyChange",
                "contentChange",
                "featureContentChange"
              ],
              "properties": {
                "statusOnlyChange": {
                  "type": "boolean",
                  "description": "True only when the sole changed field is status."
                },
                "contentChange": {
                  "type": "boolean",
                  "description": "True when at least one changed field is not status."
                },
                "featureContentChange": {
                  "type": "boolean",
                  "description": "Existing FEATURE classifier for name and the supported description, requirements, and acceptance-criteria fields."
                }
              },
              "description": "Null only when historical evidence is UNAVAILABLE."
            },
            {
              "type": "null"
            }
          ]
        },
        "creditedProposerApprovals": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 1,
              "description": "Captured/live count of approval records credited to the user proposer. Agent authorship contributes zero. This is historical decision evidence for CAPTURED and never depends on the current viewer; null when legacy terminal history is unavailable."
            },
            {
              "type": "null"
            }
          ]
        },
        "viewerEligibility": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "eligibleToApprove"
          ],
          "properties": {
            "eligibleToApprove": {
              "type": "boolean",
              "description": "Current viewer's server-derived approval eligibility, evaluated now and never stored as historical evidence."
            }
          }
        }
      },
      "description": "API-owned explanation of the rule and approval requirement for this proposal response."
    },
    "ProposalApprovalExplanationEvidence": {
      "type": "string",
      "enum": [
        "LIVE",
        "CAPTURED",
        "UNAVAILABLE"
      ],
      "description": "Pending ordinary proposals report LIVE policy on each read or decision. Terminal decisions report CAPTURED evidence from the decision transition. Legacy terminal proposals without captured evidence report UNAVAILABLE; they are never reconstructed from current policy."
    },
    "ProjectApprovalPolicyEffectiveConditions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "typeKey": {
          "type": "string",
          "minLength": 1,
          "description": "Exact effective registry key; omitted means all work-item types."
        },
        "author": {
          "$ref": "#/definitions/ProjectApprovalPolicyAuthor"
        },
        "action": {
          "$ref": "#/definitions/ProjectApprovalPolicyAction"
        },
        "change": {
          "$ref": "#/definitions/ProjectApprovalPolicyChangeSelector"
        },
        "featureContentChange": {
          "type": "boolean",
          "description": "Optional existing FEATURE-specific content classification. True means at least one changed field is name, sections.description, sections.requirements, or sections.acceptanceCriteria. It is separate from the generic change selector."
        },
        "topLevel": {
          "type": "boolean",
          "description": "API-owned structural top-level match input. Set by code defaults and by project rules on FEATURE."
        },
        "toolName": {
          "type": "string",
          "minLength": 1,
          "description": "Existing authoring-boundary match input used by code defaults."
        }
      },
      "description": "Omitted conditions match any value for that dimension. Conditions are conjunctive. For project-authored rules, typeKey, author, action, and change are the settings controls, plus topLevel on FEATURE rules; featureContentChange, topLevel, and toolName also preserve the complete effective match explanation for code-owned rules."
    },
    "ProjectApprovalPolicyRuleSource": {
      "type": "string",
      "enum": [
        "PROJECT",
        "DEFAULT",
        "FIXED"
      ],
      "description": "Origin of a rule in the effective policy."
    },
    "ProjectApprovalPolicyRequirement": {
      "type": "string",
      "enum": [
        "IMMEDIATE",
        "PROJECT_REQUIRED",
        "FIXED_REQUIRED"
      ],
      "description": "IMMEDIATE applies without human approval. PROJECT_REQUIRED uses the rule's requiredApprovals value. FIXED_REQUIRED uses a code-owned count and is never editable through project settings."
    },
    "ProjectApprovalPolicyReplaceRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedRevision",
        "rules"
      ],
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0,
          "description": "Revision from the latest policy read, including 0 on first save."
        },
        "rules": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/ProjectApprovalPolicyRule"
          },
          "description": "Complete replacement of the editable project rule layer, in global priority order."
        }
      }
    },
    "ProjectApprovalPolicyRestoreRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedRevision"
      ],
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0,
          "description": "Revision from the latest policy read; restore uses the same compare-and-swap protection as replacement."
        }
      }
    },
    "ProjectApprovalPolicyRule": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conditions",
        "requirement",
        "requiredApprovals",
        "allowsProposerApproval"
      ],
      "properties": {
        "conditions": {
          "$ref": "#/definitions/ProjectApprovalPolicyConditions"
        },
        "requirement": {
          "type": "string",
          "enum": [
            "IMMEDIATE",
            "PROJECT_REQUIRED"
          ],
          "description": "Project-authored rules cannot set FIXED_REQUIRED."
        },
        "requiredApprovals": {
          "type": "integer",
          "format": "int32",
          "minimum": 0,
          "maximum": 2147483647,
          "description": "Per-rule effective count. IMMEDIATE requires 0; PROJECT_REQUIRED requires a positive count up to 2147483647, the PostgreSQL INTEGER storage maximum. The API enforces the bound and pairing and reports a field-addressable validation issue when it is invalid."
        },
        "allowsProposerApproval": {
          "type": "boolean",
          "description": "Whether an eligible user proposer may contribute one ordinary human approval. The API still verifies the current actor and membership; clients cannot grant eligibility or proposer credit."
        }
      },
      "description": "One editable rule in project-authored global priority order."
    },
    "ProjectApprovalPolicyConditions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "typeKey": {
          "type": "string",
          "minLength": 1,
          "description": "Exact stable key in the project's effective work-item type registry. Omit to match all types; there is no registry key for the Default presentation group."
        },
        "author": {
          "$ref": "#/definitions/ProjectApprovalPolicyAuthor"
        },
        "action": {
          "$ref": "#/definitions/ProjectApprovalPolicyAction"
        },
        "change": {
          "$ref": "#/definitions/ProjectApprovalPolicyChangeSelector"
        },
        "topLevel": {
          "type": "boolean",
          "description": "Valid only when typeKey is FEATURE. True matches only top-level Features, false matches only Features that are not top-level, and omitting it matches both. The API decides whether a Feature is top-level (it has no parent task); clients only choose the condition."
        }
      }
    },
    "ProjectApprovalPolicyAuthor": {
      "type": "string",
      "enum": [
        "USER",
        "AGENT"
      ]
    },
    "ProjectApprovalPolicyAction": {
      "type": "string",
      "enum": [
        "CREATE",
        "UPDATE",
        "DELETE"
      ],
      "description": "UPDATE rules match both UPDATE and VERSIONED_UPDATE proposals. The API normalizes VERSIONED_UPDATE to UPDATE before policy evaluation; the policy action model therefore remains unchanged."
    },
    "ProjectApprovalPolicyChangeSelector": {
      "type": "string",
      "enum": [
        "STATUS_ONLY",
        "CONTENT_CHANGE"
      ],
      "description": "CONTENT_CHANGE matches when at least one changed field is not status. STATUS_ONLY matches exactly one changed field named status. These generic selectors are distinct from the existing FEATURE content classifier, which is retained on effective code-default rules and is reported in review explanations."
    }
  }
} as const;
