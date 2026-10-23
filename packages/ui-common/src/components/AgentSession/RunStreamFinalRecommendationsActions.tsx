import SyncIcon from "@mui/icons-material/SyncAlt";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { CodeReviewIcon } from "../ActionsCapsule/CodeReviewIcon";
import {
  useFinalAssessmentSecondaryActions,
  type FinalAssessmentActionId,
} from "./useFinalAssessmentSecondaryActions";

const ACTION_ICON_MAP: Record<FinalAssessmentActionId, ReactNode> = {
  sync_with_hey_hey: <SyncIcon fontSize="small" />,
  request_code_review: <CodeReviewIcon fontSize="small" />,
};

interface RunStreamFinalRecommendationsActionsProps {
  syncing: boolean;
  requestingCodeReview: boolean;
  requestingCommit: boolean;
  showCrossServiceReviewAction?: boolean;
  startingCrossServiceReview?: boolean;
  notice: string | null;
  crossServiceReviewNotice?: string | null;
  crossServiceReviewError?: string | null;
  onSync: () => void;
  onRequestCodeReview: () => void;
  onRequestCommit: () => void;
  onStartCrossServiceReview?: () => void;
}

const ACTION_BUTTON_SX = {
  flex: 1,
  minHeight: 76,
  textTransform: "none",
  justifyContent: "flex-start",
  alignItems: "flex-start",
  px: 1.5,
  py: 1.25,
} as const;

export const RunStreamFinalRecommendationsActions = ({
  syncing,
  requestingCodeReview,
  requestingCommit,
  showCrossServiceReviewAction = false,
  startingCrossServiceReview = false,
  notice,
  crossServiceReviewNotice = null,
  crossServiceReviewError = null,
  onSync,
  onRequestCodeReview,
  onRequestCommit,
  onStartCrossServiceReview,
}: RunStreamFinalRecommendationsActionsProps) => {
  const secondaryActions = useFinalAssessmentSecondaryActions({
    onSync: async () => {
      onSync();
    },
    onRequestCodeReview: async () => {
      onRequestCodeReview();
    },
  });

  const isActionLoading = (id: FinalAssessmentActionId): boolean => {
    switch (id) {
      case "sync_with_hey_hey":
        return syncing;
      case "request_code_review":
        return requestingCodeReview;
      default:
        return false;
    }
  };

  return (
    <Stack
      spacing={1.25}
      sx={(theme) => ({
        pt: 2,
        px: 1.5,
        pb: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: theme.palette.divider,
        backgroundColor:
          theme.palette.mode === "light"
            ? theme.palette.grey[100]
            : theme.palette.grey[900],
      })}
    >
      <Typography variant="subtitle2">Request final recommendations</Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.25}
        alignItems="stretch"
        flexWrap="wrap"
      >
        {secondaryActions.actions.map((action) => {
          const loading = isActionLoading(action.id);
          const status = secondaryActions.getActionStatus(action.id);

          return (
            <Button
              key={action.id}
              type="button"
              variant={action.variant}
              onClick={() => secondaryActions.executeAction(action.id)}
              disabled={loading}
              startIcon={ACTION_ICON_MAP[action.id]}
              data-testid={`run-stream-action-${action.id}`}
              sx={ACTION_BUTTON_SX}
            >
              <Stack spacing={0.25} alignItems="flex-start">
                <Typography variant="button">
                  {loading ? action.loadingLabel : action.label}
                </Typography>
                <Typography
                  variant="caption"
                  color={
                    action.variant === "contained"
                      ? "inherit"
                      : "text.secondary"
                  }
                  sx={
                    action.variant === "contained"
                      ? { opacity: 0.92 }
                      : undefined
                  }
                >
                  {action.description}
                </Typography>
                {status.state === "error" && status.error ? (
                  <Typography variant="caption" color="error.main">
                    {status.error}
                  </Typography>
                ) : null}
              </Stack>
            </Button>
          );
        })}

        <Button
          type="button"
          variant="outlined"
          onClick={onRequestCommit}
          disabled={requestingCommit}
          data-testid="run-stream-commit-submit"
          sx={ACTION_BUTTON_SX}
        >
          <Stack spacing={0.25} alignItems="flex-start">
            <Typography variant="button">
              {requestingCommit ? "Requesting commit..." : "Request commit"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Send a follow-up prompt asking to commit changed code.
            </Typography>
          </Stack>
        </Button>

        {showCrossServiceReviewAction && onStartCrossServiceReview ? (
          <Button
            type="button"
            variant="outlined"
            onClick={onStartCrossServiceReview}
            disabled={startingCrossServiceReview}
            data-testid="run-stream-cross-service-review-submit"
            sx={ACTION_BUTTON_SX}
          >
            <Stack spacing={0.25} alignItems="flex-start">
              <Typography variant="button">
                {startingCrossServiceReview
                  ? "Creating cross-service review..."
                  : "Cross Service Review"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Start a new agent session scoped to all linked service
                repositories.
              </Typography>
            </Stack>
          </Button>
        ) : null}
      </Stack>
      {notice ? (
        <Alert
          severity="success"
          variant="outlined"
          sx={{ px: 1.5, py: 0.5 }}
          data-testid="run-stream-final-recommendations-notice"
        >
          {notice}
        </Alert>
      ) : null}
      {crossServiceReviewNotice ? (
        <Typography variant="body2" color="success.main" sx={{ px: 0.25 }}>
          {crossServiceReviewNotice}
        </Typography>
      ) : null}
      {crossServiceReviewError ? (
        <Typography variant="body2" color="error.main" sx={{ px: 0.25 }}>
          {crossServiceReviewError}
        </Typography>
      ) : null}
    </Stack>
  );
};
