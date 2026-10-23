import { Alert, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { DiffRenderer } from "../../SuggestedContent/DiffRenderer";
import type { PermissionDecision } from "../../AgentSession/runtime/types";
import { useSubmitControllerAuthorizedPermissionDecision } from "../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision";
import { getCodeLanguageFromFilePath } from "./codeLanguageUtils";
import type { FieldComponentProps, FieldConfig } from "./types";
import { type AgentRequestPermissionPayload } from "../../../api";

type PermissionDeliveryState =
  | "idle"
  | "queued"
  | "in-flight"
  | "delivered"
  | "failed";

type JsonObject = Record<string, unknown>;

interface EditToolPermissionDetails {
  toolName: "Edit";
  filePath: string;
  oldString: string | null;
  newString: string | null;
  replaceAll: boolean | null;
}

const DELIVERY_STATE_LABEL: Record<PermissionDeliveryState, string> = {
  idle: "Pending",
  queued: "Queued",
  "in-flight": "In Flight",
  delivered: "Delivered",
  failed: "Failed",
};

interface PermissionRequestFieldConfig extends Omit<FieldConfig, "payload"> {
  payload: AgentRequestPermissionPayload;
}

export interface AgentPermissionRequestFieldProps
  extends Omit<FieldComponentProps<AgentRequestPermissionPayload>, "config"> {
  config: PermissionRequestFieldConfig;
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readStringByKeys = (
  record: JsonObject,
  keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const readBooleanByKeys = (
  record: JsonObject,
  keys: readonly string[]
): boolean | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
};

const readRecordByKeys = (
  record: JsonObject,
  keys: readonly string[]
): JsonObject | null => {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return null;
};

const parseEditToolPermissionDetails = (
  rawEvent: AgentRequestPermissionPayload["rawEvent"]
): EditToolPermissionDetails | null => {
  if (!isRecord(rawEvent)) {
    return null;
  }

  const toolName = readStringByKeys(rawEvent, ["toolName", "tool_name"]);
  if (!toolName || toolName.toLowerCase() !== "edit") {
    return null;
  }

  const toolInput = readRecordByKeys(rawEvent, ["toolInput", "tool_input"]);
  if (!toolInput) {
    return null;
  }

  const filePath = readStringByKeys(toolInput, ["file_path", "filePath"]);
  if (!filePath) {
    return null;
  }

  return {
    toolName: "Edit",
    filePath,
    oldString: readStringByKeys(toolInput, ["old_string", "oldString"]),
    newString: readStringByKeys(toolInput, ["new_string", "newString"]),
    replaceAll: readBooleanByKeys(toolInput, ["replace_all", "replaceAll"]),
  };
};

const isRedundantReason = (
  reason: string | null,
  permissionType: string,
  targetFile: string | null
): boolean => {
  if (!reason || !targetFile) {
    return false;
  }

  const normalizedReason = reason.trim().toLowerCase();
  const normalizedPermissionType = permissionType.trim().toLowerCase();
  const normalizedTargetFile = targetFile.trim().toLowerCase();

  return (
    normalizedReason === normalizedTargetFile ||
    normalizedReason ===
      `${normalizedPermissionType}: ${normalizedTargetFile}` ||
    normalizedReason === `${normalizedPermissionType} ${normalizedTargetFile}`
  );
};

const dedupeStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    uniqueValues.push(value);
  }

  return uniqueValues;
};

export const AgentPermissionRequestField: React.FC<
  AgentPermissionRequestFieldProps
> = ({ config, context, disabled = false, isSubmitted = false }) => {
  const { organizationId, projectId, agentSessionId } = context;
  const { submit: submitControllerDecision } =
    useSubmitControllerAuthorizedPermissionDecision(
      organizationId,
      projectId,
      agentSessionId
    );
  const [deliveryState, setDeliveryState] =
    React.useState<PermissionDeliveryState>("idle");
  const [deliveryError, setDeliveryError] = React.useState<string | null>(null);
  const [submittedDecision, setSubmittedDecision] =
    React.useState<PermissionDecision | null>(null);

  const payload = config.payload;
  const permissionRequest = payload.permissionRequest;
  // The persisted decision is the source of truth; fall back to the in-flight
  // submittedDecision for the pre-flush window so the live submit highlights
  // immediately before the message update round-trips.
  const resolvedDecision =
    (payload.decision as PermissionDecision | null | undefined) ??
    submittedDecision;
  const editToolDetails = React.useMemo(
    () => parseEditToolPermissionDetails(payload.rawEvent),
    [payload.rawEvent]
  );
  const targetFile =
    editToolDetails?.filePath ?? permissionRequest.referencedFiles[0] ?? null;
  const summarizedRequest = targetFile
    ? `${permissionRequest.permissionType} request for ${targetFile}`
    : `${permissionRequest.permissionType} request`;
  const shouldShowReason =
    !isRedundantReason(
      permissionRequest.reason ?? null,
      permissionRequest.permissionType,
      targetFile
    ) && Boolean(permissionRequest.reason);
  const additionalReferencedFiles = React.useMemo(() => {
    const uniqueFiles = dedupeStrings(permissionRequest.referencedFiles);
    if (!targetFile) {
      return uniqueFiles;
    }

    return uniqueFiles.filter((filePath) => filePath !== targetFile);
  }, [permissionRequest.referencedFiles, targetFile]);
  const diffContent =
    editToolDetails?.oldString && editToolDetails.newString
      ? {
          oldContent: editToolDetails.oldString,
          newContent: editToolDetails.newString,
        }
      : null;
  const diffLanguage = getCodeLanguageFromFilePath(
    editToolDetails?.filePath ?? null
  );

  const shouldDisableDecisionButtons =
    disabled ||
    isSubmitted ||
    resolvedDecision !== null ||
    deliveryState === "queued" ||
    deliveryState === "in-flight" ||
    deliveryState === "delivered";

  const handleDecisionClick = React.useCallback(
    async (decision: PermissionDecision) => {
      if (shouldDisableDecisionButtons) {
        return;
      }

      if (!agentSessionId) {
        setDeliveryError(
          "Missing agent session id — cannot route permission decision."
        );
        setDeliveryState("failed");
        return;
      }

      const decisionRequest = {
        decision,
        requestId: permissionRequest.id,
        sessionId: permissionRequest.sessionId,
        agentType: permissionRequest.agentType,
        reason: null,
        idempotencyToken: permissionRequest.idempotencyToken,
      };

      setDeliveryError(null);
      setSubmittedDecision(decision);
      setDeliveryState("queued");

      await Promise.resolve();
      setDeliveryState("in-flight");

      try {
        await submitControllerDecision(decisionRequest);
        setDeliveryState("delivered");
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to route permission response.";
        setDeliveryError(errorMessage);
        setDeliveryState("failed");
      }
    },
    [
      agentSessionId,
      permissionRequest.agentType,
      permissionRequest.id,
      permissionRequest.idempotencyToken,
      permissionRequest.sessionId,
      shouldDisableDecisionButtons,
      submitControllerDecision,
    ]
  );

  return (
    <Stack spacing={2} data-testid={`permission-request-field-${config.field}`}>
      <Stack
        spacing={1}
        data-testid={`permission-request-details-${permissionRequest.id}`}
      >
        <Typography
          variant="subtitle2"
          data-testid={`permission-request-summary-${permissionRequest.id}`}
        >
          {summarizedRequest}
        </Typography>

        {shouldShowReason ? (
          <Typography
            variant="body2"
            data-testid={`permission-request-reason-${permissionRequest.id}`}
          >
            {`Reason: ${permissionRequest.reason}`}
          </Typography>
        ) : null}

        {permissionRequest.agentIntent ? (
          <Typography
            variant="body2"
            data-testid={`permission-request-agent-intent-${permissionRequest.id}`}
          >
            {`Agent intent: ${permissionRequest.agentIntent}`}
          </Typography>
        ) : null}

        {editToolDetails?.replaceAll ? (
          <Typography
            variant="body2"
            data-testid={`permission-request-edit-replace-all-${permissionRequest.id}`}
          >
            Replace all matches in target file
          </Typography>
        ) : null}

        {diffContent ? (
          <Stack
            spacing={0.5}
            data-testid={`permission-request-diff-${permissionRequest.id}`}
          >
            <Typography variant="caption" color="text.secondary">
              Requested changes
            </Typography>
            <DiffRenderer
              oldContent={diffContent.oldContent}
              newContent={diffContent.newContent}
              viewMode="split-code"
              codeLanguage={diffLanguage}
            />
          </Stack>
        ) : null}

        {additionalReferencedFiles.length > 0 ? (
          <Stack
            spacing={0.5}
            data-testid={`permission-request-referenced-files-${permissionRequest.id}`}
          >
            <Typography variant="caption" color="text.secondary">
              Referenced files
            </Typography>
            {additionalReferencedFiles.map((referencedFile, index) => (
              <Typography
                key={`${referencedFile}-${String(index)}`}
                variant="body2"
                sx={{ fontFamily: "monospace" }}
                data-testid={`permission-request-referenced-file-${
                  permissionRequest.id
                }-${String(index)}`}
              >
                {referencedFile}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>

      <Stack direction="row" spacing={1} justifyContent="flex-start">
        <Button
          variant={resolvedDecision === "approve" ? "contained" : "outlined"}
          color="success"
          disabled={shouldDisableDecisionButtons}
          onClick={() => {
            void handleDecisionClick("approve");
          }}
          data-testid={`permission-request-approve-${permissionRequest.id}`}
        >
          Approve
        </Button>
        <Button
          variant={
            resolvedDecision === "always_approve" ? "contained" : "outlined"
          }
          color="success"
          disabled={shouldDisableDecisionButtons}
          onClick={() => {
            void handleDecisionClick("always_approve");
          }}
          data-testid={`permission-request-always-approve-${permissionRequest.id}`}
        >
          Always Approve
        </Button>
        <Button
          variant={resolvedDecision === "whitelist" ? "contained" : "outlined"}
          color="success"
          disabled={shouldDisableDecisionButtons}
          onClick={() => {
            void handleDecisionClick("whitelist");
          }}
          data-testid={`permission-request-whitelist-${permissionRequest.id}`}
        >
          Whitelist
        </Button>
        <Button
          variant={resolvedDecision === "deny" ? "contained" : "outlined"}
          color="error"
          disabled={shouldDisableDecisionButtons}
          onClick={() => {
            void handleDecisionClick("deny");
          }}
          data-testid={`permission-request-deny-${permissionRequest.id}`}
        >
          Deny
        </Button>
      </Stack>

      {resolvedDecision ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid={`permission-request-submitted-decision-${permissionRequest.id}`}
        >
          {`Decision: ${
            resolvedDecision === "always_approve"
              ? "always approve"
              : resolvedDecision === "whitelist"
              ? "whitelisted"
              : resolvedDecision
          }${
            !payload.decision ? ` (${DELIVERY_STATE_LABEL[deliveryState]})` : ""
          }`}
        </Typography>
      ) : null}

      {deliveryError ? (
        <Alert
          severity="error"
          data-testid={`permission-request-delivery-error-${permissionRequest.id}`}
        >
          {deliveryError}
        </Alert>
      ) : null}
    </Stack>
  );
};
