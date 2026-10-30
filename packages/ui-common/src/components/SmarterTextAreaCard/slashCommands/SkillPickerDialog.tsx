import { FunctionalDialog as Dialog } from "../../Modals/FunctionalDialog";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import type { AgentSkillCatalogEntry, AgentSkillSelection } from "../../../api";
import {
  skillSelectionFromCatalogEntry,
  useAgentSkillsCatalog,
} from "../../AgentSession/runtime/hooks/useAgentSkillsCatalog";
import type { AgentComposerContext } from "./types";

export interface SkillPickerDialogProps {
  open: boolean;
  context: AgentComposerContext;
  onClose: () => void;
  onSelect: (selection: AgentSkillSelection) => void;
}

const formatScope = (scope: AgentSkillCatalogEntry["catalogScope"]): string =>
  scope.replace(/_/g, " ");

const getDisplayName = (entry: AgentSkillCatalogEntry): string =>
  entry.interface?.displayName?.trim() || entry.name;

const getDescription = (entry: AgentSkillCatalogEntry): string =>
  entry.interface?.shortDescription?.trim() ||
  entry.shortDescription?.trim() ||
  entry.description;

const SkillCatalogRows = ({
  entries,
  onSelect,
}: {
  entries: readonly AgentSkillCatalogEntry[];
  onSelect: (selection: AgentSkillSelection) => void;
}) => (
  <List disablePadding data-testid="skill-picker-options">
    {entries.map((entry) => (
      <ListItem key={`${entry.provider}:${entry.catalogScope}:${entry.name}`}>
        <ListItemButton
          data-testid="skill-picker-option"
          data-skill-name={entry.name}
          disabled={!entry.enabled}
          onClick={() => onSelect(skillSelectionFromCatalogEntry(entry))}
          sx={{ borderRadius: 1 }}
        >
          <ListItemText
            primary={
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 0, sm: 1 }}
                alignItems={{ xs: "flex-start", sm: "baseline" }}
              >
                <Typography component="span" fontWeight={600}>
                  {getDisplayName(entry)}
                </Typography>
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  {entry.provider} · {formatScope(entry.catalogScope)}
                </Typography>
              </Stack>
            }
            secondary={getDescription(entry)}
          />
        </ListItemButton>
      </ListItem>
    ))}
  </List>
);

export const SkillPickerDialog = ({
  open,
  context,
  onClose,
  onSelect,
}: SkillPickerDialogProps) => {
  const { state, reload } = useAgentSkillsCatalog({
    enabled: open,
    ...context,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      data-testid="skill-picker-dialog"
      closeControl={
        <IconButton
          aria-label="Close Skill picker"
          data-testid="close-skill-picker"
          onClick={onClose}
          sx={{ ml: "auto" }}
        >
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        Choose an installed Skill
      </DialogTitle>
      <Divider />
      <DialogContent dividers>
        {state.status === "read-error" ? (
          <Alert
            severity="error"
            data-testid="skill-picker-read-error"
            data-error-code={state.code}
          >
            <Typography>{state.message}</Typography>
            {state.retryable ? (
              <Button data-testid="skill-picker-retry" onClick={reload}>
                Try again
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {state.status === "loading" ? (
          <Alert severity="info" data-testid="skill-picker-loading">
            Discovering Skills on the selected Codex machine...
          </Alert>
        ) : null}

        {state.status === "empty" ? (
          <Alert severity="info" data-testid="skill-picker-empty">
            No enabled Skills were found for this Codex workspace.
          </Alert>
        ) : null}

        {state.status === "discovery-error" ? (
          <Alert severity="error" data-testid="skill-picker-error">
            <Stack spacing={1}>
              <Typography>
                Codex could not discover the installed Skills.
              </Typography>
              {state.errors.map((error, index) => (
                <Typography key={`${error.provider}:${index}`} variant="body2">
                  {error.message}
                </Typography>
              ))}
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={reload}
                sx={{ alignSelf: "flex-start" }}
              >
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : null}

        {state.status === "bridge-unavailable" ? (
          <Alert severity="error" data-testid="skill-picker-bridge-unavailable">
            <Stack spacing={1}>
              <Typography>{state.message}</Typography>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={reload}
                sx={{ alignSelf: "flex-start" }}
              >
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : null}

        {state.status === "ready" ? (
          <Stack spacing={1}>
            {state.catalog.errors.length > 0 ? (
              <Alert
                severity="warning"
                data-testid="skill-picker-discovery-warning"
              >
                Some Skill locations could not be read. The available results
                are still shown below.
              </Alert>
            ) : null}
            <SkillCatalogRows
              entries={state.catalog.skills}
              onSelect={onSelect}
            />
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
