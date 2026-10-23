import React from "react";
import {
  Autocomplete,
  TextField,
  Stack,
  Button,
  Box,
  Chip,
  FormControl,
  Select,
  MenuItem,
  OutlinedInput,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TitleIcon from "@mui/icons-material/Title";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import PsychologyIcon from "@mui/icons-material/Psychology";
import type { AdvancedSearchEntityScope } from "./types";
import type { PastSearch } from "./pastSearches";

export type SearchMode = "title" | "content" | "agent";

/**
 * Props for SearchInputs component
 */
export interface SearchInputsProps {
  titleQuery: string;
  onTitleQueryChange: (query: string) => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  isLoading?: boolean;
  onSearch?: (mode?: SearchMode) => void;
  scopedEntity?: AdvancedSearchEntityScope | null;
  onClearScopedEntity?: () => void;
  pastSearchOptions?: PastSearch[];
  onPastSearchSelect?: (pastSearch: PastSearch) => void;
}

const ENTITY_SCOPE_LABELS: Record<
  AdvancedSearchEntityScope["entityType"],
  string
> = {
  INITIATIVE: "initiative",
  TASK: "task",
};

const formatEntityScopeLabel = (
  scopedEntity: AdvancedSearchEntityScope,
): string =>
  `${ENTITY_SCOPE_LABELS[scopedEntity.entityType]} (${scopedEntity.entityId})`;

/**
 * Search input component with title search and search action.
 */
const SEARCH_MODE_CONFIG: Record<
  SearchMode,
  { label: string; placeholder: string }
> = {
  title: {
    label: "Title Search",
    placeholder: "Search by name or title...",
  },
  content: {
    label: "Content Search",
    placeholder: "Search by meaning across entity content...",
  },
  agent: {
    label: "Agent Search",
    placeholder: "Describe what you're looking for in natural language...",
  },
};

const MODE_BUTTONS: ReadonlyArray<{
  mode: SearchMode;
  label: string;
  icon: typeof TitleIcon;
}> = [
  { mode: "title", label: "Title", icon: TitleIcon },
  { mode: "content", label: "Content", icon: BlurOnIcon },
  { mode: "agent", label: "Agent", icon: PsychologyIcon },
];

export const SearchInputs: React.FC<SearchInputsProps> = ({
  titleQuery,
  onTitleQueryChange,
  searchMode,
  onSearchModeChange,
  isLoading = false,
  onSearch,
  scopedEntity = null,
  onClearScopedEntity,
  pastSearchOptions,
  onPastSearchSelect,
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const textColor = theme.palette.mode === "dark" ? "#fff" : "#333";

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Enter fires the search in the current mode (no explicit override).
    if (e.key === "Enter" && !e.shiftKey && onSearch) {
      e.preventDefault();
      onSearch();
    }
  };

  // Selecting a mode switches it and immediately fires the search in that mode.
  // The explicit mode is passed through so the search runs in the clicked mode
  // even though onSearchModeChange's state update lands in the next tick.
  const handleModeClick = (mode: SearchMode): void => {
    if (!onSearch) return;
    onSearchModeChange(mode);
    onSearch(mode);
  };

  const modeConfig = SEARCH_MODE_CONFIG[searchMode];

  const renderModeSelector = (): React.ReactElement => {
    if (isCompact) {
      const selectedMode = MODE_BUTTONS.find(({ mode }) => mode === searchMode);
      const SelectedModeIcon = selectedMode?.icon ?? TitleIcon;

      return (
        <FormControl
          sx={{
            flex: "0 0 auto",
            width: { xs: 56, sm: 64 },
            minWidth: 0,
            height: 56,
          }}
        >
          <Select<SearchMode>
            value={searchMode}
            onChange={(event) => {
              handleModeClick(event.target.value as SearchMode);
            }}
            input={
              <OutlinedInput inputProps={{ "aria-label": "Search mode" }} />
            }
            renderValue={() => (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                }}
              >
                <SelectedModeIcon aria-hidden="true" />
              </Box>
            )}
            displayEmpty
            disabled={isLoading}
            data-testid="search-mode-mobile"
            sx={{
              height: 56,
              "& .MuiSelect-select": {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 1,
              },
            }}
          >
            {MODE_BUTTONS.map(({ mode, label, icon: Icon }) => (
              <MenuItem key={mode} value={mode}>
                <Icon sx={{ mr: 1 }} />
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    return (
      <Box sx={{ display: "flex", gap: 0.5 }}>
        {MODE_BUTTONS.map(({ mode, label, icon: Icon }) => {
          const isActive = searchMode === mode;
          return (
            <Button
              key={mode}
              variant="outlined"
              onClick={() => handleModeClick(mode)}
              aria-pressed={isActive}
              data-testid={`search-mode-${mode}`}
              startIcon={<Icon />}
              sx={{
                flexDirection: "column",
                padding: "8px 10px",
                textTransform: "none",
                fontSize: "12px",
                minWidth: 64,
                height: 56,
                border: "none",
                color: isActive ? textColor : "text.secondary",
                "& .MuiButton-startIcon": {
                  display: "grid",
                  placeItems: "center",
                  lineHeight: 0,
                  marginLeft: 0,
                  marginRight: 0,
                  marginBottom: "2px",
                  padding: "6px",
                  borderRadius: "50%",
                  backgroundColor: isActive
                    ? theme.palette.primary.main
                    : "transparent",
                  border: isActive ? "none" : "solid 1px currentColor",
                },
                "& .MuiButton-startIcon .MuiSvgIcon-root": {
                  display: "block",
                  color: isActive
                    ? theme.palette.primary.contrastText
                    : "inherit",
                },
              }}
            >
              {label}
            </Button>
          );
        })}
      </Box>
    );
  };

  return (
    <Box>
      <Stack spacing={2}>
        {scopedEntity && (
          <Chip
            color="primary"
            variant="outlined"
            label={`Searching within ${formatEntityScopeLabel(scopedEntity)}`}
            onDelete={onClearScopedEntity}
            disabled={isLoading}
          />
        )}

        <Box
          sx={{
            display: "flex",
            gap: 2,
            alignItems: { xs: "stretch", md: "flex-start" },
            flexDirection: { xs: "column", md: "row" },
            width: "100%",
            minWidth: 0,
            "& > *": { minWidth: 0 },
          }}
        >
          <Box
            sx={{
              display: "flex",
              gap: 2,
              alignItems: "flex-start",
              flex: { xs: "0 0 auto", md: "1 1 auto" },
              width: { xs: "100%", md: "auto" },
              minWidth: 0,
            }}
            data-testid="search-input-mode-row"
          >
            {searchMode === "agent" && onPastSearchSelect ? (
              <Autocomplete
                fullWidth
                freeSolo
                options={pastSearchOptions ?? []}
                getOptionLabel={(opt) =>
                  typeof opt === "string" ? opt : opt.query
                }
                inputValue={titleQuery}
                onInputChange={(_e, value, reason) => {
                  if (reason !== "reset") onTitleQueryChange(value);
                }}
                onChange={(_e, value) => {
                  if (value && typeof value !== "string") {
                    onPastSearchSelect(value);
                  }
                }}
                disabled={isLoading}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={modeConfig.label}
                    placeholder={modeConfig.placeholder}
                    onKeyDown={handleKeyDown}
                    slotProps={{
                      input: {
                        ...params.InputProps,
                        startAdornment: (
                          <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />
                        ),
                        endAdornment: onSearch ? (
                          <Typography
                            variant="caption"
                            sx={{
                              color: "text.secondary",
                              whiteSpace: "nowrap",
                              ml: 1,
                            }}
                          >
                            Press ↵ to search
                          </Typography>
                        ) : undefined,
                      },
                    }}
                  />
                )}
              />
            ) : (
              <TextField
                fullWidth
                label={modeConfig.label}
                placeholder={modeConfig.placeholder}
                value={titleQuery}
                onChange={(e) => onTitleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                slotProps={{
                  input: {
                    startAdornment: (
                      <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />
                    ),
                    endAdornment: onSearch ? (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          whiteSpace: "nowrap",
                          ml: 1,
                        }}
                      >
                        Press ↵ to search
                      </Typography>
                    ) : undefined,
                  },
                }}
              />
            )}

            {onSearch && isCompact && renderModeSelector()}
          </Box>

          {onSearch && !isCompact && renderModeSelector()}
        </Box>
      </Stack>
    </Box>
  );
};
