import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
} from "@mui/material";
import {
  ControllerAuthorizationCadence,
  type ControllerAuthorizationCadence as ControllerAuthorizationCadenceValue,
} from "../../api";
import type { ControllerAuthorizationPromptCause } from "./controllerAuthorizationPrompt";

export interface ControllerAuthorizationCadenceDialogProps {
  cause?: ControllerAuthorizationPromptCause | null;
  errorMessage: string | null;
  machineName: string;
  onAuthorize: () => void;
  onCadenceChange: (cadence: ControllerAuthorizationCadenceValue) => void;
  onCancel: () => void;
  open: boolean;
  selectedCadence: ControllerAuthorizationCadenceValue;
}

const OPTIONS = [
  [ControllerAuthorizationCadence.FiveMinutes, "5 minutes"],
  [ControllerAuthorizationCadence.EightHours, "8 hours"],
  [ControllerAuthorizationCadence.OneDay, "1 day"],
  [ControllerAuthorizationCadence.OneWeek, "1 week"],
  [ControllerAuthorizationCadence.OneMonth, "1 month"],
] as const satisfies ReadonlyArray<
  readonly [ControllerAuthorizationCadenceValue, string]
>;

const isCadence = (
  value: string
): value is ControllerAuthorizationCadenceValue =>
  OPTIONS.some(([cadence]) => cadence === value);

export const ControllerAuthorizationCadenceDialog = ({
  cause,
  errorMessage,
  machineName,
  onAuthorize,
  onCadenceChange,
  onCancel,
  open,
  selectedCadence,
}: ControllerAuthorizationCadenceDialogProps) => (
  <Dialog
    data-testid="controller-authorization-cadence-dialog"
    fullWidth
    maxWidth="sm"
    onClose={onCancel}
    open={open}
  >
    <DialogTitle>Authorize actions on {machineName}</DialogTitle>
    <DialogContent>
      <Stack spacing={2}>
        <DialogContentText>
          Your passkey authorizes actions on the selected execution machine.
          Choose how often this browser profile should ask for authorization.
        </DialogContentText>
        {cause ? (
          <Alert
            data-testid="controller-authorization-cause"
            severity="info"
            variant="outlined"
          >
            <Stack spacing={0.5}>
              <DialogContentText>
                {`The system would like to ${cause.operation}.`}
              </DialogContentText>
              {cause.purpose ? (
                <DialogContentText>
                  {`Purpose: ${cause.purpose}`}
                </DialogContentText>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
        {errorMessage ? <Alert severity="warning">{errorMessage}</Alert> : null}
        <FormControl>
          <FormLabel id="controller-authorization-cadence-label">
            Ask for passkey authorization
          </FormLabel>
          <RadioGroup
            aria-labelledby="controller-authorization-cadence-label"
            onChange={(event) => {
              if (isCadence(event.target.value)) {
                onCadenceChange(event.target.value);
              }
            }}
            value={selectedCadence}
          >
            {OPTIONS.map(([cadence, label]) => (
              <FormControlLabel
                control={<Radio />}
                data-cadence={cadence}
                data-testid="controller-authorization-cadence-option"
                key={cadence}
                label={label}
                value={cadence}
              />
            ))}
          </RadioGroup>
        </FormControl>
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button data-testid="controller-authorization-cancel" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        data-testid="controller-authorization-continue"
        onClick={onAuthorize}
        variant="contained"
      >
        Continue with passkey
      </Button>
    </DialogActions>
  </Dialog>
);
