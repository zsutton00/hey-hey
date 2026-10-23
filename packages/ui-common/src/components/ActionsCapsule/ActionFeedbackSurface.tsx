import { Alert, Box, Button, Drawer, Popover, Stack } from "@mui/material";
import type { CapsuleActionUnavailableFeedback } from "./types";

export interface ActionFeedbackSurfaceProps {
  actionId: string;
  actionLabel: string;
  anchorEl: HTMLElement | null;
  feedback: CapsuleActionUnavailableFeedback;
  mobile: boolean;
  onClose: () => void;
}

const FeedbackContent = ({
  actionId,
  actionLabel,
  feedback,
  onClose,
}: Pick<
  ActionFeedbackSurfaceProps,
  "actionId" | "actionLabel" | "feedback" | "onClose"
>) => (
  <Box
    data-testid="capsule-action-feedback-surface"
    data-action-id={actionId}
    sx={{ p: 2, minWidth: { xs: "auto", sm: 300 }, maxWidth: 420 }}
  >
    <Alert severity="warning" variant="outlined">
      <Box component="span" sx={{ display: "block", mb: 1 }}>
        {actionLabel} is unavailable.
      </Box>
      <Box component="span">{feedback.reason}</Box>
    </Alert>
    <Stack
      direction="row"
      spacing={1}
      justifyContent="flex-end"
      sx={{ mt: 1.5 }}
    >
      {feedback.retryable ? (
        <Button
          color="warning"
          size="small"
          onClick={feedback.retry}
          disabled={feedback.isRetrying}
          data-testid="capsule-action-feedback-retry"
        >
          {feedback.isRetrying ? "Retrying…" : "Retry"}
        </Button>
      ) : null}
      <Button
        color="inherit"
        size="small"
        onClick={onClose}
        data-testid="capsule-action-feedback-hide"
      >
        Hide
      </Button>
    </Stack>
  </Box>
);

export const ActionFeedbackSurface = ({
  actionId,
  actionLabel,
  anchorEl,
  feedback,
  mobile,
  onClose,
}: ActionFeedbackSurfaceProps) => {
  const content = (
    <FeedbackContent
      actionId={actionId}
      actionLabel={actionLabel}
      feedback={feedback}
      onClose={onClose}
    />
  );

  if (mobile) {
    return (
      <Drawer
        anchor="bottom"
        open={anchorEl !== null}
        onClose={onClose}
        slotProps={{
          paper: {
            sx: {
              bottom: "calc(48px + env(safe-area-inset-bottom))",
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              maxHeight: "min(60vh, 360px)",
            },
          },
        }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Popover
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      slotProps={{ paper: { sx: { overflow: "visible" } } }}
    >
      {content}
    </Popover>
  );
};
