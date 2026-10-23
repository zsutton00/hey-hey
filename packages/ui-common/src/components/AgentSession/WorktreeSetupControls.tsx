import {
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

export interface WorktreeSetupControlsProps {
  branch: string | null;
  locked: boolean;
  onChangeBranch: (branch: string | null) => void;
  toggleTestId: string;
  controlsTestId: string;
  branchTestId: string;
}

export const WorktreeSetupControls = ({
  branch,
  locked,
  onChangeBranch,
  toggleTestId,
  controlsTestId,
  branchTestId,
}: WorktreeSetupControlsProps) => {
  const enabled = branch !== null;

  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={(event) =>
              onChangeBranch(event.target.checked ? "" : null)
            }
            disabled={locked}
            data-testid={toggleTestId}
          />
        }
        label={<Typography variant="body2">Enable worktree</Typography>}
      />

      {enabled ? (
        <Stack spacing={2} data-testid={controlsTestId}>
          <TextField
            label="Branch name"
            value={branch ?? ""}
            onChange={(event) => onChangeBranch(event.target.value)}
            disabled={locked}
            placeholder="worktree-branch"
            fullWidth
            size="small"
            slotProps={{
              htmlInput: {
                readOnly: locked,
                "data-testid": branchTestId,
              },
            }}
          />
        </Stack>
      ) : null}
    </>
  );
};
