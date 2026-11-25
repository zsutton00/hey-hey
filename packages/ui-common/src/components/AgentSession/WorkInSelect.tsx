import { useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ServicePlaceChoice } from "../../api";
import {
  MAIN_FOLDER_OPTION_KEY,
  branchOptionKey,
  buildPlaceOptions,
  type PlaceOption,
} from "./runtime/hooks/placeOptions";
import type { ServicePlacesEntry } from "./runtime/hooks/useServicePlaces";

type ReadyEntry = Extract<ServicePlacesEntry, { status: "ready" }>;

/**
 * One shared Branch or worktree field for every launch surface. `value: null`
 * means the default (the main folder as it is). Callers building the launch
 * request must map each Service's value with `resolveChoice` (./resolveChoice)
 * so the default becomes an explicit MAIN_FOLDER choice.
 */
export interface WorkInSelectProps {
  serviceId: string;
  /** This Service's places; an error entry renders as a per-Service alert. */
  entry: ServicePlacesEntry;
  /** The current choice. Null means the default: the main folder as it is. */
  value: ServicePlaceChoice | null;
  /**
   * True when nothing may be assumed for this Service: with no value the field
   * asks for a choice instead of showing the main folder.
   */
  requireChoice?: boolean;
  /** A Plan's branch. When set it replaces the field and cannot be changed. */
  lockedBranch: string | null;
  searching: boolean;
  /** Message from a failed branch search, or null. */
  searchError: string | null;
  disabled: boolean;
  /** Receives the typed text so the caller can search branches while typing. */
  onBranchQueryChange: (query: string) => void;
  onChange: (choice: ServicePlaceChoice) => void;
}

const FIELD_WIDTH = 280;
const MENU_WIDTH = 340;
const LABEL = "Branch or worktree";

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

const optionBranchLabel = (option: PlaceOption): string => {
  if (option.kind === "place") {
    return option.branch ?? "detached";
  }

  return option.kind === "notice" ? option.text : "";
};

/** The text shown in the field for a picked place, e.g. "dev · main folder". */
const selectedText = (
  entry: ReadyEntry,
  value: ServicePlaceChoice | null,
): string => {
  const mainBranch = entry.mainFolder.branch ?? "detached";
  if (value === null || value.kind === "MAIN_FOLDER") {
    return `${mainBranch} · main folder`;
  }
  const isExisting =
    !value.newBranch &&
    hasWorktree(entry, value.branch) &&
    value.branch !== entry.mainFolder.branch;

  return `${value.branch} · ${isExisting ? "worktree" : "new worktree"}`;
};

/** The option that stands for the current value, when the menu may not list it. */
const optionForValue = (
  entry: ReadyEntry,
  value: ServicePlaceChoice | null,
): PlaceOption => {
  if (value === null || value.kind === "MAIN_FOLDER") {
    return {
      kind: "place",
      key: MAIN_FOLDER_OPTION_KEY,
      group: "Recent",
      branch: entry.mainFolder.branch,
      tag: "main folder",
    };
  }

  return {
    kind: "place",
    key: branchOptionKey(value.branch),
    group: "Recent",
    branch: value.branch,
    tag: hasWorktree(entry, value.branch) ? "worktree" : "new worktree",
  };
};

export const WorkInSelect = ({
  serviceId,
  entry,
  value,
  requireChoice = false,
  lockedBranch,
  searching,
  searchError,
  disabled,
  onBranchQueryChange,
  onChange,
}: WorkInSelectProps) => {
  const [typed, setTyped] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const readyEntry = entry.status === "ready" ? entry : null;

  const menuOptions = useMemo(
    () =>
      readyEntry === null
        ? []
        : buildPlaceOptions({
            entry: readyEntry,
            query: typed ?? "",
            searchError,
          }),
    [readyEntry, typed, searchError],
  );

  if (lockedBranch !== null) {
    return (
      <TextField
        size="small"
        disabled
        label={LABEL}
        value={`Plan branch: ${lockedBranch}`}
        data-testid="work-in-locked"
        data-service-id={serviceId}
        sx={{ width: FIELD_WIDTH, maxWidth: "100%" }}
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
  const conflict = conflictsWithMainFolder(entry, value);
  const pickedNewBranchNote =
    value?.kind === "WORKTREE" &&
    !value.newBranch &&
    isUncheckedOut(entry, value.branch);
  const mainBranch = entry.mainFolder.branch;

  // The picked place may not be in the menu (a typed-only branch, a created
  // worktree); it is added so the field always has a valid value, and is kept
  // out of what the menu shows.
  const selected = unchosen ? null : optionForValue(entry, value);
  const selectedMissing =
    selected !== null && !menuOptions.some((o) => o.key === selected.key);
  const allOptions =
    selected !== null && selectedMissing
      ? [...menuOptions, selected]
      : menuOptions;
  const selectedOption =
    selected === null
      ? null
      : (allOptions.find((o) => o.key === selected.key) ?? selected);
  const inputText = typed ?? (unchosen ? "" : selectedText(entry, value));

  const pick = (option: PlaceOption | null): void => {
    if (option === null || option.kind !== "place") {
      return;
    }
    setCreating(false);
    setTyped(null);
    onBranchQueryChange("");
    if (option.key === MAIN_FOLDER_OPTION_KEY || option.branch === null) {
      onChange({ serviceId, kind: "MAIN_FOLDER" });
      return;
    }
    onChange(choiceForBranch(serviceId, entry, option.branch));
  };

  const createWorktree = (): void => {
    setCreating(false);
    onChange({
      serviceId,
      kind: "WORKTREE",
      branch: newBranchName.trim(),
      newBranch: true,
    });
  };

  const noOptionsText =
    searchError !== null
      ? "Branch search failed"
      : searching
        ? "Searching…"
        : "No matching branches.";

  return (
    <Stack spacing={1} data-testid="work-in" data-service-id={serviceId}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Autocomplete<PlaceOption>
          size="small"
          disabled={disabled}
          options={allOptions}
          value={selectedOption}
          inputValue={inputText}
          filterOptions={(options) =>
            options.filter((o) => !selectedMissing || o !== selected)
          }
          isOptionEqualToValue={(a, b) => a.key === b.key}
          getOptionKey={(option) => option.key}
          getOptionLabel={(option) =>
            option.kind === "place"
              ? selectedText(entry, choiceFor(option, serviceId, entry))
              : optionBranchLabel(option)
          }
          getOptionDisabled={(option) => option.kind !== "place"}
          groupBy={(option) => option.group}
          noOptionsText={noOptionsText}
          clearIcon={null}
          onChange={(_event, option) => pick(option)}
          onInputChange={(_event, text, reason) => {
            // "reset" only echoes the value's label back; the field shows it
            // whenever nothing is being typed.
            if (reason === "input") {
              setTyped(text);
              onBranchQueryChange(text);
            }
          }}
          onClose={() => {
            setTyped(null);
            onBranchQueryChange("");
          }}
          selectOnFocus
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: string };
            if (option.kind === "detached") {
              return (
                <li
                  key={key}
                  {...rest}
                  data-testid="work-in-option-detached-worktree"
                >
                  <Typography variant="body2" color="text.disabled">
                    Detached worktree · no branch to choose
                  </Typography>
                </li>
              );
            }
            if (option.kind === "notice") {
              return (
                <li
                  key={key}
                  {...rest}
                  data-testid={
                    option.key === "search-error"
                      ? "work-in-search-error"
                      : "work-in-search-note"
                  }
                >
                  <Typography variant="caption" color="text.secondary">
                    {option.text}
                  </Typography>
                </li>
              );
            }

            return (
              <li
                key={key}
                {...rest}
                data-testid="work-in-option"
                data-branch={option.branch ?? ""}
                data-tag={option.tag}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  justifyContent="space-between"
                  sx={{ width: "100%", minWidth: 0 }}
                >
                  <Typography variant="body2" noWrap>
                    {option.branch ?? "detached"}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flexShrink: 0 }}
                  >
                    {option.tag}
                  </Typography>
                </Stack>
              </li>
            );
          }}
          slotProps={{
            paper: { sx: { width: MENU_WIDTH, maxWidth: "90vw" } },
            listbox: { sx: { maxHeight: 280 } },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={LABEL}
              placeholder={unchosen ? "Choose where to work" : undefined}
              slotProps={{
                input: params.InputProps,
                htmlInput: {
                  ...params.inputProps,
                  "data-testid": "work-in-select",
                },
              }}
            />
          )}
          sx={{ width: FIELD_WIDTH, minWidth: 0 }}
        />
        <Button
          variant="outlined"
          disabled={disabled}
          onClick={() => {
            setNewBranchName("");
            setCreating(true);
          }}
          data-testid="work-in-new-worktree-button"
          sx={{ whiteSpace: "nowrap", height: 40, flexShrink: 0 }}
        >
          New worktree
        </Button>
      </Stack>

      {creating ? (
        <Stack spacing={1} data-testid="work-in-new">
          <TextField
            size="small"
            autoFocus
            label="New branch name"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            helperText={`Starts from ${mainBranch ?? "the main folder's current commit"}.`}
            data-testid="work-in-new-input"
            sx={{ width: FIELD_WIDTH, maxWidth: "100%" }}
          />
          <Box>
            <Button
              size="small"
              variant="contained"
              disabled={newBranchName.trim() === ""}
              onClick={createWorktree}
              data-testid="work-in-new-confirm"
            >
              Use new worktree
            </Button>
          </Box>
        </Stack>
      ) : null}

      {conflict ? (
        <Alert severity="warning" data-testid="work-in-conflict">
          The main folder already has{" "}
          {value?.kind === "WORKTREE" ? value.branch : ""} checked out, so a
          worktree can't open on it. Choose another place.
        </Alert>
      ) : null}

      {pickedNewBranchNote && value?.kind === "WORKTREE" ? (
        <Stack
          spacing={0.5}
          alignItems="flex-start"
          data-testid="work-in-new-worktree-note"
          sx={{ maxWidth: MENU_WIDTH }}
        >
          <Typography variant="caption" color="text.secondary">
            {value.branch} isn't checked out anywhere. It will open in its own
            new worktree, so your main folder stays on{" "}
            {mainBranch ?? "its current commit"}.
          </Typography>
          <Button
            size="small"
            variant="contained"
            disabled={disabled}
            onClick={() => onChange(value)}
            data-testid="work-in-open-as-worktree"
          >
            Open as worktree
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
};

/** The choice an option stands for, used to label it in the field. */
const choiceFor = (
  option: Extract<PlaceOption, { kind: "place" }>,
  serviceId: string,
  entry: ReadyEntry,
): ServicePlaceChoice =>
  option.key === MAIN_FOLDER_OPTION_KEY || option.branch === null
    ? { serviceId, kind: "MAIN_FOLDER" }
    : choiceForBranch(serviceId, entry, option.branch);
