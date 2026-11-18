/**
 * Auto-generated from specs/agent-bridge/openapi.yaml.
 * Do not edit manually; regenerate from the OpenAPI source.
 */
import type { LocalLifecycleWork, LocalStartupBrowserRecord } from './models.js';
export type LocalLifecycleRuntimeSchemaTypes = {
  LocalLifecycleWork: LocalLifecycleWork;
  LocalStartupBrowserRecord: LocalStartupBrowserRecord;
};
export const localLifecycleRuntimeSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "LocalLifecycleWork": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "runIds"
      ],
      "properties": {
        "runIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "LocalStartupBrowserRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "event",
        "sequence",
        "observedAt"
      ],
      "properties": {
        "event": {
          "$ref": "#/definitions/LocalStartupBrowserEvent"
        },
        "sequence": {
          "type": "integer",
          "minimum": 1
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "facts": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "authenticated": {
              "type": "boolean"
            },
            "loading": {
              "type": "boolean"
            },
            "handoffPending": {
              "type": "boolean"
            },
            "nameSaved": {
              "type": "boolean"
            },
            "machineConnected": {
              "type": "boolean"
            },
            "hasProjects": {
              "type": "boolean"
            },
            "setupUnfinished": {
              "type": "boolean"
            },
            "replacementSession": {
              "type": "boolean"
            },
            "passkeyCount": {
              "type": "integer",
              "minimum": 0
            },
            "status": {
              "type": "integer",
              "minimum": 100,
              "maximum": 599
            },
            "errorName": {
              "type": "string",
              "enum": [
                "Error",
                "TypeError",
                "SyntaxError",
                "AxiosError",
                "AbortError",
                "TimeoutError",
                "SecurityError",
                "InvalidStateError",
                "NotAllowedError",
                "NotSupportedError",
                "WebAuthnCancelledError",
                "WebAuthnUnsupportedError",
                "PasskeyCeremonyCancelledError",
                "PasskeyUnsupportedError",
                "MachineEnrollmentClaimError",
                "UnknownError"
              ]
            },
            "transportCode": {
              "type": "string",
              "enum": [
                "ERR_NETWORK",
                "ERR_BAD_REQUEST",
                "ERR_BAD_RESPONSE",
                "ECONNABORTED",
                "ETIMEDOUT",
                "ERR_CANCELED"
              ]
            },
            "elapsedMs": {
              "type": "number",
              "minimum": 0
            },
            "view": {
              "type": "string",
              "enum": [
                "loading",
                "name",
                "error",
                "passkey-step",
                "continuing",
                "missing-pairing-details",
                "waiting-for-cli"
              ]
            },
            "destination": {
              "type": "string",
              "enum": [
                "login",
                "welcome",
                "home"
              ]
            },
            "reason": {
              "type": "string",
              "enum": [
                "unauthenticated",
                "connected",
                "terminal_socket_auth",
                "request_failed",
                "unknown_failure"
              ]
            }
          }
        }
      }
    },
    "LocalStartupBrowserEvent": {
      "type": "string",
      "description": "Closed vocabulary; no arbitrary messages, user content or secret values.",
      "enum": [
        "mounted",
        "unmounted",
        "handoff_started",
        "handoff_accepted",
        "handoff_failed",
        "handoff_missing",
        "status_failed",
        "name_saving",
        "name_saved",
        "name_failed",
        "connection_timeout",
        "repair_requested",
        "repair_offered",
        "repair_failed",
        "passkey_failed",
        "setup_view",
        "setup_status",
        "passkey_inventory",
        "auth_state",
        "auth_renewal_started",
        "auth_renewal_succeeded",
        "auth_renewal_failed",
        "auth_cleared",
        "socket_renewal_started",
        "socket_renewal_failed",
        "passkey_registration_started",
        "passkey_registration_succeeded",
        "passkey_registration_failed",
        "replacement_session_accepted",
        "setup_redirect"
      ]
    }
  }
};
