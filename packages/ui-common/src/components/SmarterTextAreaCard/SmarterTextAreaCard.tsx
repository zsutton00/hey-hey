import React, { useEffect, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";
import { useActionGuard } from "../../hooks";
import { SlideLeft, SlideRight } from "../../animations";
import Save from "@mui/icons-material/Save";
import Psychology from "@mui/icons-material/Psychology";
import CheckCircle from "@mui/icons-material/CheckCircle";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import {
  NO_SLASH_FOCAL_ENTITY,
  type SlashFocalEntityState,
} from "./slashCommands/types";
import { useProjectIds } from "../../hooks/useEditorContext";
import type { FileReferenceScope } from "../../data/hooks/useFileReferenceCandidates";
import { SmarterTextAreaEditor } from "./SmarterTextAreaEditor";

type SaveStatus =
  "draft" | "saving" | "saved" | "submitting" | "sent" | "complete";
type SaveMode = "silent" | "feedback" | null;
type SmarterTextAreaActionLockBehavior = "immediate" | "external-only";
type SmarterTextAreaRendering = "rich" | "plain";

type SaveActionKey = "silent-save" | "feedback-save";

export interface SmarterTextAreaCardProps {
  value: string;
  onChange: (value: string) => void;
  mentionConversationId?: string;
  disabled?: boolean;
  placeholder?: string;
  headerText?: string;
  saveStatus: SaveStatus;
  saveMode: SaveMode;
  hasUnsavedChanges: boolean;
  required?: boolean;
  maxRows?: number;
  minRows?: number;
  multiline?: boolean;
  minInputHeight?: number | string;
  onSaveWithoutFeedback?: () => void;
  onSaveWithFeedback?: () => void;
  isSaving?: boolean;
  saveWithoutFeedbackText?: string;
  saveWithFeedbackText?: string;
  saveWithoutFeedbackIcon?: React.ReactNode;
  saveWithFeedbackIcon?: React.ReactNode;
  error?: boolean;
  helperText?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  headerSx?: SxProps<Theme>;
  actionLockBehavior?: SmarterTextAreaActionLockBehavior;
  /** Called when the user presses Cmd+Enter (or Ctrl+Enter) */
  onSubmit?: () => void;
  /**
   * When true, the editor surface inherits its container's background
   * instead of using `background.paper`. Use this when embedding inside
   * an elevation-tinted Paper (e.g. an MUI Dialog in dark mode) where
   * the hard-coded paper color would visually mismatch its surroundings.
   */
  transparent?: boolean;
  /** Controls whether picker actions render rich mentions or plain tokens. */
  rendering?: SmarterTextAreaRendering;
  /** Entity whose already-cached Context may seed slash entity lookup. */
  focalEntity?: SlashFocalEntityState;
  /** Scope for touched-file suggestions owned by the caller. */
  fileReferenceScope?: FileReferenceScope | null;
}

const getStatusIcon = (status: SaveStatus): React.ReactNode => {
  switch (status) {
    case "draft":
      return null;
    case "saving":
    case "submitting":
      return <CircularProgress size={16} />;
    case "saved":
    case "sent":
    case "complete":
      return <CheckCircle fontSize="small" />;
    default:
      return null;
  }
};

const getStatusColor = (status: SaveStatus): string => {
  switch (status) {
    case "draft":
      return "text.secondary";
    case "saving":
    case "submitting":
      return "primary.main";
    case "saved":
    case "sent":
    case "complete":
      return "success.main";
    default:
      return "text.secondary";
  }
};

export const SmarterTextAreaCard: React.FC<SmarterTextAreaCardProps> = ({
  disabled = false,
  error = false,
  hasUnsavedChanges,
  headerText,
  helperText,
  isSaving = false,
  minInputHeight = "100px",
  onChange,
  onSaveWithFeedback,
  onSaveWithoutFeedback,
  onFocus,
  onBlur,
  placeholder,
  headerSx,
  saveMode,
  saveStatus,
  saveWithFeedbackIcon,
  saveWithFeedbackText,
  saveWithoutFeedbackIcon,
  saveWithoutFeedbackText,
  value,
  mentionConversationId,
  actionLockBehavior = "immediate",
  onSubmit,
  transparent = false,
  rendering = "rich",
  focalEntity = NO_SLASH_FOCAL_ENTITY,
  fileReferenceScope = null,
}) => {
  const { t } = useTranslation();
  const { guard } = useActionGuard();
  const theme = useTheme();
  const conversationId = mentionConversationId ?? null;
  const editorContextData = useProjectIds();

  const showSaveWithoutFeedback = !!onSaveWithoutFeedback;
  const showSaveWithFeedback = !!onSaveWithFeedback;

  const defaultSaveWithoutFeedbackText =
    saveWithoutFeedbackText || t(KEYS.common.save);
  const defaultSaveWithFeedbackText =
    saveWithFeedbackText || t(KEYS.initiatives.editor.saveAndGetFeedback);
  const defaultSaveWithoutFeedbackIcon = saveWithoutFeedbackIcon || <Save />;
  const defaultSaveWithFeedbackIcon = saveWithFeedbackIcon || <Psychology />;
  const [locallyLockedAction, setLocallyLockedAction] =
    React.useState<SaveActionKey | null>(null);
  const externallyLockedAction = isSaving
    ? saveMode === "silent"
      ? "silent-save"
      : saveMode === "feedback"
        ? "feedback-save"
        : showSaveWithoutFeedback && !showSaveWithFeedback
          ? "silent-save"
          : showSaveWithFeedback && !showSaveWithoutFeedback
            ? "feedback-save"
            : locallyLockedAction
    : null;
  const effectiveLockedAction =
    actionLockBehavior === "immediate"
      ? (externallyLockedAction ?? locallyLockedAction)
      : externallyLockedAction;
  const latestIsSavingRef = useRef(isSaving);

  useEffect(() => {
    latestIsSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    if (
      actionLockBehavior === "immediate" &&
      locallyLockedAction !== null &&
      !hasUnsavedChanges
    ) {
      setLocallyLockedAction(null);
    }
  }, [actionLockBehavior, hasUnsavedChanges, locallyLockedAction]);

  const lockAction = React.useCallback(
    (actionKey: SaveActionKey, action?: () => void) => {
      if (!action) {
        return;
      }

      if (actionLockBehavior !== "immediate") {
        action();
        return;
      }

      setLocallyLockedAction(actionKey);

      try {
        action();
      } finally {
        queueMicrotask(() => {
          if (!latestIsSavingRef.current) {
            setLocallyLockedAction((current) =>
              current === actionKey ? null : current,
            );
          }
        });
      }
    },
    [actionLockBehavior],
  );
  const isAnyActionLocked = effectiveLockedAction !== null;

  return (
    <Paper
      data-testid="smarter-textarea-card"
      elevation={0}
      sx={{
        overflow: "hidden",
        border: "none",
      }}
    >
      {headerText && (
        <Box
          data-testid="smarter-textarea-card-header"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            pt: 1.5,
            pb: 1.5,
            bgcolor: "background.paper",
            borderBottom: `1px solid ${theme.palette.divider}`,
            ...(headerSx || {}),
          }}
        >
          {/* Q Icon */}
          <Typography
            sx={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
              flexShrink: 0,
            }}
          >
            Q
          </Typography>

          {/* Header Text */}
          <Typography
            variant="body2"
            color="text.primary"
            sx={{
              flex: 1,
              fontSize: "0.875rem",
            }}
          >
            {headerText}
          </Typography>

          {/* Status Icon */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: getStatusColor(saveStatus),
              flexShrink: 0,
            }}
          >
            {getStatusIcon(saveStatus)}
          </Box>
        </Box>
      )}

      <SmarterTextAreaEditor
        context={
          editorContextData
            ? {
                organizationId: editorContextData.organizationId,
                projectId: editorContextData.projectId,
                conversationId,
              }
            : null
        }
        initialValue={value}
        onChange={onChange}
        fileReferenceScope={fileReferenceScope}
        focalEntity={focalEntity}
        editable={!disabled}
        submitDisabled={disabled}
        onSubmit={onSubmit}
        rendering={rendering}
        presentation={{
          containerSx: {
            bgcolor: transparent ? "transparent" : "background.paper",
            position: "relative",
            border: `1px solid ${theme.palette.divider}`,
            ...(headerText
              ? {
                  borderTop: "none",
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                }
              : { borderRadius: "14px" }),
          },
          contentEditableTestId: "smarter-textarea-input",
          contentEditableStyle: {
            outline: "none",
            padding: "16px",
            minHeight: minInputHeight,
            fontSize: "1.125rem",
            lineHeight: 1.5,
          },
          onFocus,
          onBlur,
          placeholder,
          placeholderStyle: {
            color: theme.palette.text.secondary,
          },
        }}
      />

      {helperText && (
        <Typography
          variant="caption"
          color={error ? "error.main" : "text.secondary"}
          sx={{ px: 2, pb: 1, display: "block" }}
        >
          {helperText}
        </Typography>
      )}

      {(showSaveWithoutFeedback || showSaveWithFeedback) && (
        <Box
          sx={{
            display: "flex",
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
            opacity: hasUnsavedChanges ? 1 : 0.4,
            transition: "opacity 0.3s",
          }}
        >
          {showSaveWithoutFeedback && (
            <SlideLeft
              delay={showSaveWithFeedback ? 0.15 : 0.1}
              duration="fast"
              style={{ flex: 1, display: "flex" }}
            >
              <Button
                data-testid="smarter-textarea-save-without-feedback"
                variant="text"
                size="small"
                onClick={guard("silent-save", () =>
                  lockAction("silent-save", onSaveWithoutFeedback),
                )}
                disabled={disabled || isAnyActionLocked || !hasUnsavedChanges}
                startIcon={
                  effectiveLockedAction === "silent-save" ? (
                    <CircularProgress size={16} />
                  ) : (
                    defaultSaveWithoutFeedbackIcon
                  )
                }
                sx={{
                  width: "100%",
                  py: 1.5,
                  borderRadius: 0,
                  textTransform: "none",
                }}
              >
                {effectiveLockedAction === "silent-save"
                  ? t(KEYS.common.processing)
                  : defaultSaveWithoutFeedbackText}
              </Button>
            </SlideLeft>
          )}
          {showSaveWithFeedback && (
            <SlideRight
              delay={0.1}
              duration="fast"
              style={{ flex: 1, display: "flex" }}
            >
              <Button
                data-testid="smarter-textarea-save-with-feedback"
                variant="text"
                size="small"
                onClick={guard("feedback-save", () =>
                  lockAction("feedback-save", onSaveWithFeedback),
                )}
                disabled={disabled || isAnyActionLocked || !hasUnsavedChanges}
                startIcon={
                  effectiveLockedAction === "feedback-save" ? (
                    <CircularProgress size={16} />
                  ) : (
                    defaultSaveWithFeedbackIcon
                  )
                }
                sx={{
                  width: "100%",
                  py: 1.5,
                  borderRadius: 0,
                  borderRight: showSaveWithoutFeedback
                    ? `1px solid ${theme.palette.divider}`
                    : "none",
                  textTransform: "none",
                  backgroundColor: theme.palette.actionable.main,
                  color: theme.palette.actionable.contrastText,
                  "&:hover": {
                    backgroundColor: theme.palette.actionable.dark,
                  },
                }}
              >
                {effectiveLockedAction === "feedback-save"
                  ? t(KEYS.common.processing)
                  : defaultSaveWithFeedbackText}
              </Button>
            </SlideRight>
          )}
        </Box>
      )}
    </Paper>
  );
};
