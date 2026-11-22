import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import type { ServicePlaceChoice } from "../../api";
import type { ServicePlacesEntry } from "./runtime/hooks/useServicePlaces";

type ReadyEntry = Extract<ServicePlacesEntry, { status: "ready" }>;

/**
 * One shared Work in list for every launch surface. `value: null` means the
 * default (the main folder as it is). Callers building the launch request must
 * map each Service's value with `resolveChoice` (./resolveChoice) so the default becomes an
 * explicit MAIN_FOLDER choice.
 */
export interface WorkInSelectProps {
  serviceId: string;
  /** This Service's places; an error entry renders as a per-Service alert. */
  entry: ServicePlacesEntry;
  /** The current choice. Null means the default: the main folder as it is. */
  value: ServicePlaceChoice | null;
  /**
   * True when nothing may be assumed for this Service: with no value the list
   * asks for a choice instead of showing the main folder.
   */
  requireChoice?: boolean;
  /** A Plan's branch. When set it replaces the list and cannot be changed. */
  lockedBranch: string | null;
  branchQuery: string;
  searching: boolean;
  /** Message from a failed branch search, or null. */
  searchError: string | null;
  disabled: boolean;
  onBranchQueryChange: (query: string) => void;
  onChange: (choice: ServicePlaceChoice) => void;
}

type Mode = "list" | "search" | "new";

const KEY_CURRENT = "current";
const KEY_OTHER = "other";
const KEY_NEW = "new";
const KEY_CONFLICT = "conflict";
const worktreeKey = (branch: string) => `worktree:${branch}`;
const recentKey = (branch: string) => `recent:${branch}`;
const pickedKey = (branch: string) => `picked:${branch}`;

/**
 * A worktree on the branch the main folder has checked out. Git cannot make
 * one, and the CLI refuses it, so it must be replaced rather than shown as the
 * main folder.
 */
export const conflictsWithMainFolder = (
  entry: ReadyEntry,
  value: ServicePlaceChoice | null,
): boolean =>
  value?.kind === "WORKTREE" && value.branch === entry.mainFolder.branch;

const currentLabel = (entry: ReadyEntry): string =>
  `Current: ${entry.mainFolder.branch ?? "detached"} (main folder)`;

const hasWorktree = (entry: ReadyEntry, branch: string): boolean =>
  entry.worktrees.some((worktree) => worktree.branch === branch);

const isUncheckedOut = (entry: ReadyEntry, branch: string): boolean =>
  branch !== entry.mainFolder.branch && !hasWorktree(entry, branch);

/** Maps a branch picked from any group to the choice it stands for. */
const choiceForBranch = (
  serviceId: string,
  entry: ReadyEntry,
  branch: string,
): ServicePlaceChoice =>
  branch === entry.mainFolder.branch
    ? { serviceId, kind: "MAIN_FOLDER" }
    : { serviceId, kind: "WORKTREE", branch, newBranch: false };

const selectedKeyFor = (
  entry: ReadyEntry,
  value: ServicePlaceChoice | null,
): string => {
  if (value === null || value.kind === "MAIN_FOLDER") {
    return KEY_CURRENT;
  }
  if (conflictsWithMainFolder(entry, value)) {
    return KEY_CONFLICT;
  }
  if (value.newBranch) {
    return KEY_NEW;
  }

  if (hasWorktree(entry, value.branch)) {
    return worktreeKey(value.branch);
  }

  return entry.recentBranches.some((recent) => recent.branch === value.branch)
    ? recentKey(value.branch)
    : pickedKey(value.branch);
};

const selectedLabelFor = (
  entry: ReadyEntry,
  value: ServicePlaceChoice | null,
): string => {
  if (value === null || selectedKeyFor(entry, value) === KEY_CURRENT) {
    return currentLabel(entry);
  }
  if (value.kind === "WORKTREE" && conflictsWithMainFolder(entry, value)) {
    return `${value.branch} (new worktree)`;
  }
  if (value.kind === "WORKTREE" && value.newBranch) {
    return `New worktree: ${value.branch}`;
  }

  return value.kind === "WORKTREE" ? value.branch : currentLabel(entry);
};

export const WorkInSelect = ({
  serviceId,
  entry,
  value,
  requireChoice = false,
  lockedBranch,
  branchQuery,
  searching,
  searchError,
  disabled,
  onBranchQueryChange,
  onChange,
}: WorkInSelectProps) => {
  const [mode, setMode] = useState<Mode>("list");
  const [newBranchName, setNewBranchName] = useState("");

  if (lockedBranch !== null) {
    return (
      <TextField
        size="small"
        fullWidth
        disabled
        label="Work in"
        value={`Plan branch: ${lockedBranch}`}
        data-testid="work-in-locked"
        data-service-id={serviceId}
      />
    );
  }

  if (entry.status === "error") {
    return (
      <Alert
        severity="error"
        data-testid="work-in-error"
        data-service-id={serviceId}
      >
        {entry.message}
      </Alert>
    );
  }

  const unchosen = requireChoice && value === null;
  const selectedKey = unchosen ? "" : selectedKeyFor(entry, value);
  const conflict = conflictsWithMainFolder(entry, value);
  const pickedNewBranchNote =
    value?.kind === "WORKTREE" &&
    !value.newBranch &&
    isUncheckedOut(entry, value.branch);

  const handleSelect = (event: SelectChangeEvent<string>): void => {
    const key = event.target.value;

    if (key === KEY_OTHER) {
      setMode("search");
      return;
    }
    if (key === KEY_NEW) {
      setNewBranchName("");
      setMode("new");
      return;
    }

    setMode("list");
    if (key === KEY_CURRENT) {
      onChange({ serviceId, kind: "MAIN_FOLDER" });
      return;
    }

    const branch = key.slice(key.indexOf(":") + 1);
    onChange(choiceForBranch(serviceId, entry, branch));
  };

  const pickSearchMatch = (branch: string): void => {
    setMode("list");
    onBranchQueryChange("");
    onChange(choiceForBranch(serviceId, entry, branch));
  };

  const createWorktree = (): void => {
    const branch = newBranchName.trim();
    setMode("list");
    onChange({ serviceId, kind: "WORKTREE", branch, newBranch: true });
  };

  const labelId = `work-in-label-${serviceId}`;

  return (
    <Stack spacing={1} data-testid="work-in" data-service-id={serviceId}>
      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel id={labelId}>Work in</InputLabel>
        <Select
          labelId={labelId}
          label="Work in"
          value={selectedKey}
          onChange={handleSelect}
          displayEmpty
          renderValue={() =>
            unchosen ? "Choose where to work" : selectedLabelFor(entry, value)
          }
          data-testid="work-in-select"
        >
          <ListSubheader>Current</ListSubheader>
          <MenuItem value={KEY_CURRENT} data-testid="work-in-option-current">
            {currentLabel(entry)}
          </MenuItem>

          {entry.worktrees.length > 0 ? (
            <ListSubheader>Worktrees</ListSubheader>
          ) : null}
          {entry.worktrees.map((worktree) =>
            worktree.branch === null ? (
              <MenuItem
                key={worktree.worktreePath}
                value={worktree.worktreePath}
                disabled
                data-testid="work-in-option-detached-worktree"
              >
                Detached worktree (no branch to choose)
              </MenuItem>
            ) : (
              <MenuItem
                key={worktree.worktreePath}
                value={worktreeKey(worktree.branch)}
                data-testid="work-in-option-worktree"
              >
                {worktree.branch}
              </MenuItem>
            ),
          )}

          {entry.recentBranches.length > 0 ? (
            <ListSubheader>Recently used here</ListSubheader>
          ) : null}
          {entry.recentBranches.map((recent) => (
            <MenuItem
              key={recent.branch}
              value={recentKey(recent.branch)}
              data-testid="work-in-option-recent"
            >
              {isUncheckedOut(entry, recent.branch)
                ? `${recent.branch} (no worktree)`
                : recent.branch}
            </MenuItem>
          ))}

          {selectedKey.startsWith("picked:") || conflict ? (
            // Keeps a branch picked from search a valid Select value.
            <MenuItem value={selectedKey} sx={{ display: "none" }}>
              {selectedLabelFor(entry, value)}
            </MenuItem>
          ) : null}

          <MenuItem value={KEY_OTHER} data-testid="work-in-option-other">
            Other branch…
          </MenuItem>
          <MenuItem value={KEY_NEW} data-testid="work-in-option-new">
            New worktree…
          </MenuItem>
        </Select>
      </FormControl>

      {mode === "search" ? (
        <Box data-testid="work-in-search">
          <TextField
            size="small"
            fullWidth
            autoFocus
            label="Search branches"
            value={branchQuery}
            onChange={(event) => onBranchQueryChange(event.target.value)}
            data-testid="work-in-search-input"
          />
          {branchQuery.trim() === "" ? null : (
            <List dense data-testid="work-in-search-results">
              {entry.branchMatches.map((branch) => (
                <ListItemButton
                  key={branch}
                  onClick={() => pickSearchMatch(branch)}
                  data-testid="work-in-search-result"
                >
                  <ListItemText
                    primary={branch}
                    secondary={
                      isUncheckedOut(entry, branch) ? "No worktree" : undefined
                    }
                  />
                </ListItemButton>
              ))}
              {searchError !== null ? (
                <Typography
                  variant="body2"
                  color="error"
                  data-testid="work-in-search-error"
                >
                  Branch search failed
                </Typography>
              ) : null}
              {entry.branchMatches.length === 0 &&
              !searching &&
              searchError === null ? (
                <Typography variant="body2" color="text.secondary">
                  No matching branches.
                </Typography>
              ) : null}
              {entry.branchMatchesTruncated ? (
                <Typography variant="caption" color="text.secondary">
                  More branches match. Keep typing to narrow them.
                </Typography>
              ) : null}
            </List>
          )}
        </Box>
      ) : null}

      {mode === "new" ? (
        <Stack spacing={1} data-testid="work-in-new">
          <TextField
            size="small"
            fullWidth
            autoFocus
            label="New branch name"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            helperText={`Starts from ${entry.mainFolder.branch ?? "the main folder's current commit"}.`}
            data-testid="work-in-new-input"
          />
          <Button
            size="small"
            variant="contained"
            disabled={newBranchName.trim() === ""}
            onClick={createWorktree}
            data-testid="work-in-new-confirm"
          >
            Use new worktree
          </Button>
        </Stack>
      ) : null}

      {conflict ? (
        <Alert severity="warning" data-testid="work-in-conflict">
          The main folder already has{" "}
          {value?.kind === "WORKTREE" ? value.branch : ""} checked out, so a
          worktree can't open on it. Choose another place.
        </Alert>
      ) : null}

      {pickedNewBranchNote ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="work-in-new-worktree-note"
        >
          This branch isn't checked out anywhere, so it opens in its own new
          worktree. The main folder stays as it is.
        </Typography>
      ) : null}
    </Stack>
  );
};
