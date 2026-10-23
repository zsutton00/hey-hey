import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  List,
  ListItem,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useReportProblem } from "./useReportProblem";

interface ReportProblemDialogProps {
  open: boolean;
  onClose: () => void;
  productLocation: string;
  correlationId?: string | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export const ReportProblemDialog = ({
  open,
  onClose,
  productLocation,
  correlationId,
  returnFocusRef,
}: ReportProblemDialogProps) => {
  const [description, setDescription] = useState("");
  const [consented, setConsented] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const wasOpenRef = useRef(false);
  const { state, submit, reset } = useReportProblem();
  const submitting = state.status === "submitting";
  const succeeded = state.status === "succeeded";
  const descriptionInvalid = attempted && !description.trim();
  const consentInvalid = attempted && !consented;
  const boundedCorrelationId = correlationId?.trim() || null;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDescription("");
      setConsented(false);
      setAttempted(false);
      reset();
    }

    if (!open && wasOpenRef.current) {
      window.requestAnimationFrame(() => returnFocusRef?.current?.focus());
    }
    wasOpenRef.current = open;
  }, [open, reset, returnFocusRef]);

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async () => {
    setAttempted(true);
    if (!description.trim() || !consented || submitting || succeeded) return;

    await submit({
      description: description.trim(),
      productLocation,
      correlationId: boundedCorrelationId,
      diagnosticConsent: true,
    });
  };

  const privacyNotice = boundedCorrelationId
    ? "Include this product location and correlation identifier with my report."
    : "Include this product location with my report.";

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="report-problem-title"
      aria-describedby="report-problem-disclosure"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="report-problem-title">Report a problem</DialogTitle>
      <DialogContent>
        <TextField
          required
          autoFocus
          fullWidth
          multiline
          minRows={4}
          margin="normal"
          label="What happened?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={descriptionInvalid}
          helperText={
            descriptionInvalid
              ? "Describe the problem before submitting."
              : `${description.length}/10000`
          }
          slotProps={{ htmlInput: { maxLength: 10000 } }}
          disabled={submitting || succeeded}
        />

        <Box component="section" aria-labelledby="report-context-title" mt={2}>
          <Typography id="report-context-title" variant="subtitle1">
            Product context
          </Typography>
          <List dense disablePadding>
            <ListItem disableGutters>
              <Typography variant="body2">
                Product location: {productLocation}
              </Typography>
            </ListItem>
            {boundedCorrelationId && (
              <ListItem disableGutters>
                <Typography variant="body2">
                  Correlation identifier: {boundedCorrelationId}
                </Typography>
              </ListItem>
            )}
          </List>
        </Box>

        <Box id="report-problem-disclosure" mt={2}>
          <FormControlLabel
            control={
              <Checkbox
                checked={consented}
                onChange={(_, checked) => setConsented(checked)}
                disabled={submitting || succeeded}
              />
            }
            label={privacyNotice}
          />
          {consentInvalid && (
            <FormHelperText error>
              Consent is required before submitting.
            </FormHelperText>
          )}
        </Box>

        <Box aria-live="polite" mt={2}>
          {state.status === "failed" && (
            <Alert severity="error">{state.message}</Alert>
          )}
          {state.status === "succeeded" && (
            <Alert severity="success">Your problem was reported.</Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          {succeeded ? "Close" : "Cancel"}
        </Button>
        {!succeeded && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? "Submitting…"
              : state.status === "failed"
                ? "Retry"
                : "Submit report"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
