import React from "react";
import {
  Badge,
  Box,
  Checkbox,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  TextField,
  Chip,
  OutlinedInput,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";

type FilterIcon = React.JSXElementConstructor<Record<string, never>>;

/**
 * Configuration for a single filter
 */
export interface FilterConfig {
  /**
   * Type of filter to render
   */
  type: "search" | "select" | "multiselect" | "daterange" | "custom";

  /**
   * Unique key for this filter (used in values object)
   */
  key: string;

  /**
   * Display label for the filter
   */
  label: string;

  /**
   * Icon shown for this filter in the compact layout. Status and other filters
   * have sensible defaults when no icon is provided.
   */
  icon?: FilterIcon;

  /**
   * Options for select/multiselect filters
   */
  options?: { value: string | number; label: string }[];

  /**
   * Placeholder text for search/text inputs
   */
  placeholder?: string;

  /**
   * Custom render function for complex filter types
   */
  customRender?: (
    value: unknown,
    onChange: (value: unknown) => void
  ) => React.ReactNode;
}

/**
 * Props for EntityFilters component
 */
export interface EntityFiltersProps {
  /**
   * Array of filter configurations
   */
  filters: FilterConfig[];

  /**
   * Current filter values keyed by filter key
   */
  values: Record<string, unknown>;

  /**
   * Callback when any filter value changes
   */
  onChange: (key: string, value: unknown) => void;

  /**
   * Sort options to display
   */
  sortOptions?: { value: string; label: string }[];

  /**
   * Current sort value
   */
  sortBy?: string;

  /**
   * Callback when sort changes
   */
  onSortChange?: (value: string) => void;

  /**
   * Layout direction for filters
   */
  layout?: "row" | "column";

  /**
   * Spacing between filter controls
   */
  spacing?: number;

  /**
   * Additional sx applied to the outer Paper
   */
  sx?: SxProps<Theme>;
}

type CompactControl = { type: "filter"; filterKey: string } | { type: "sort" };

interface CompactPopoverState {
  anchorEl: HTMLElement;
  control: CompactControl;
}

const COMPACT_ICON_BUTTON_SX = {
  width: 44,
  height: 44,
  flex: "0 0 auto",
  borderRadius: 1,
  border: "1px solid",
  borderColor: "divider",
};

const hasActiveFilterValue = (value: unknown): boolean => {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false
  ) {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const getFilterIcon = (filter: FilterConfig): FilterIcon => {
  if (filter.icon) return filter.icon;
  return filter.key === "status" ? RadioButtonCheckedIcon : FilterListIcon;
};

const renderCompactFilterOptions = (
  filter: FilterConfig,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  closePopover: () => void,
  renderFilter: (filter: FilterConfig) => React.ReactNode
): React.ReactNode => {
  if (filter.type === "custom") {
    return (
      <Box sx={{ px: 2, pt: 1, pb: 6 }}>
        {filter.customRender?.(value, (nextValue) =>
          onChange(filter.key, nextValue)
        )}
      </Box>
    );
  }

  if (filter.type === "select") {
    return (
      <Box role="menu" aria-label={`${filter.label} options`}>
        <MenuItem
          role="menuitemradio"
          aria-checked={!hasActiveFilterValue(value)}
          selected={!hasActiveFilterValue(value)}
          onClick={() => {
            onChange(filter.key, "");
            closePopover();
          }}
        >
          All
        </MenuItem>
        {filter.options?.map((option) => (
          <MenuItem
            key={option.value}
            role="menuitemradio"
            aria-checked={value === option.value}
            selected={value === option.value}
            onClick={() => {
              onChange(filter.key, option.value);
              closePopover();
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Box>
    );
  }

  if (filter.type === "multiselect") {
    const selectedValues = Array.isArray(value) ? value : [];
    return (
      <Box role="menu" aria-label={`${filter.label} options`}>
        {filter.options?.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <MenuItem
              key={option.value}
              role="menuitemcheckbox"
              aria-checked={selected}
              onClick={() =>
                onChange(
                  filter.key,
                  selected
                    ? selectedValues.filter(
                        (selectedValue) => selectedValue !== option.value
                      )
                    : [...selectedValues, option.value]
                )
              }
            >
              <Checkbox checked={selected} size="small" />
              <ListItemText primary={option.label} />
            </MenuItem>
          );
        })}
      </Box>
    );
  }

  return <Box sx={{ p: 2 }}>{renderFilter(filter)}</Box>;
};

/**
 * Flexible filter component that adapts to entity-specific fields
 *
 * Supports multiple filter types:
 * - search: Text search with icon
 * - select: Single-select dropdown
 * - multiselect: Multi-select with chips
 * - daterange: Date range picker (future)
 * - custom: Custom render function
 *
 * @example
 * ```typescript
 * <EntityFilters
 *   filters={WORK_ITEM_FILTERS}
 *   values={{
 *     search: searchTerm,
 *     status: statusFilter,
 *     assignee: assigneeFilter
 *   }}
 *   onChange={handleFilterChange}
 *   sortOptions={WORK_ITEM_SORT_OPTIONS}
 *   sortBy={sortBy}
 *   onSortChange={setSortBy}
 * />
 * ```
 */
export const EntityFilters: React.FC<EntityFiltersProps> = ({
  filters,
  values,
  onChange,
  sortOptions,
  sortBy,
  onSortChange,
  layout = "row",
  spacing = 2,
  sx,
}) => {
  const compactPopoverId = React.useId();
  const [compactPopover, setCompactPopover] =
    React.useState<CompactPopoverState | null>(null);

  const renderFilter = (filter: FilterConfig): React.ReactNode => {
    const value = values[filter.key];

    switch (filter.type) {
      case "search":
        return (
          <Box
            key={filter.key}
            sx={{ flex: { md: "1 1 auto" }, width: { xs: "100%", md: "auto" } }}
          >
            <TextField
              fullWidth
              label={filter.label}
              placeholder={filter.placeholder || filter.label}
              value={(value as string) || ""}
              onChange={(e) => onChange(filter.key, e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
        );

      case "select":
        return (
          <Box
            key={filter.key}
            sx={{
              flex: { md: "0 0 200px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth>
              <InputLabel>{filter.label}</InputLabel>
              <Select
                value={(value as string) || ""}
                onChange={(e) => onChange(filter.key, e.target.value)}
                label={filter.label}
              >
                <MenuItem value="">All</MenuItem>
                {filter.options?.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        );

      case "multiselect": {
        const multiValue = (value as string[]) || [];
        return (
          <Box
            key={filter.key}
            sx={{
              flex: { md: "0 0 250px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth>
              <InputLabel>{filter.label}</InputLabel>
              <Select<string[]>
                multiple
                value={multiValue}
                onChange={(e) => {
                  const newValue =
                    typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value;
                  onChange(filter.key, newValue);
                }}
                input={<OutlinedInput label={filter.label} />}
                renderValue={(selected: string[]) => (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {selected.map((val: string) => (
                      <Chip key={val} label={val} size="small" />
                    ))}
                  </Box>
                )}
              >
                {filter.options?.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        );
      }

      case "daterange":
        // Future: Implement date range picker
        return (
          <Box
            key={filter.key}
            sx={{
              flex: { md: "0 0 200px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <TextField
              fullWidth
              label={filter.label}
              placeholder="Date range (coming soon)"
              disabled
            />
          </Box>
        );

      case "custom":
        return (
          <Box key={filter.key}>
            {filter.customRender?.(value, (newValue) =>
              onChange(filter.key, newValue)
            )}
          </Box>
        );

      default:
        return null;
    }
  };

  const nonSearchFilters = filters.filter((filter) => filter.type !== "search");
  const searchFilters = filters.filter((filter) => filter.type === "search");
  const hasCompactControls =
    nonSearchFilters.length > 0 || Boolean(sortOptions && onSortChange);
  const closeCompactPopover = (): void => setCompactPopover(null);

  const renderSortSelect = (): React.ReactNode => {
    if (!sortOptions || !onSortChange) return null;
    return (
      <Box
        key="sort"
        sx={{
          flex: { md: "0 0 200px" },
          width: { xs: "100%", md: "auto" },
        }}
      >
        <FormControl fullWidth>
          <InputLabel>Sort by</InputLabel>
          <Select
            value={sortBy || ""}
            onChange={(e) => onSortChange(e.target.value)}
            label="Sort by"
          >
            {sortOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    );
  };

  const renderCompactFilterButton = (filter: FilterConfig): React.ReactNode => {
    const Icon = getFilterIcon(filter);
    const isOpen =
      compactPopover?.control.type === "filter" &&
      compactPopover.control.filterKey === filter.key;

    return (
      <IconButton
        key={filter.key}
        aria-label={filter.label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? compactPopoverId : undefined}
        sx={COMPACT_ICON_BUTTON_SX}
        onClick={(event) =>
          setCompactPopover({
            anchorEl: event.currentTarget,
            control: { type: "filter", filterKey: filter.key },
          })
        }
      >
        <Badge
          variant="dot"
          color="primary"
          overlap="circular"
          invisible={!hasActiveFilterValue(values[filter.key])}
        >
          <Icon />
        </Badge>
      </IconButton>
    );
  };

  const renderCompactSortButton = (): React.ReactNode => {
    if (!sortOptions || !onSortChange) return null;
    const isOpen = compactPopover?.control.type === "sort";
    const hasActiveSort =
      sortOptions.length > 0 && sortBy !== sortOptions[0].value;

    return (
      <IconButton
        aria-label="Sort by"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? compactPopoverId : undefined}
        sx={COMPACT_ICON_BUTTON_SX}
        onClick={(event) =>
          setCompactPopover({
            anchorEl: event.currentTarget,
            control: { type: "sort" },
          })
        }
      >
        <Badge
          variant="dot"
          color="primary"
          overlap="circular"
          invisible={!hasActiveSort}
        >
          <SortIcon />
        </Badge>
      </IconButton>
    );
  };

  const activeFilterKey =
    compactPopover?.control.type === "filter"
      ? compactPopover.control.filterKey
      : undefined;
  const activeFilter = filters.find((filter) => filter.key === activeFilterKey);
  const activePopoverLabel =
    compactPopover?.control.type === "sort" ? "Sort by" : activeFilter?.label;

  return (
    <Paper sx={{ p: 3, mb: 3, ...sx }}>
      <Box
        sx={{
          display: "flex",
          flexDirection:
            layout === "row" ? { xs: "column", md: "row" } : "column",
          gap: spacing,
          alignItems:
            layout === "row" ? { xs: "stretch", md: "center" } : "stretch",
        }}
      >
        {layout === "row" ? (
          <>
            {searchFilters.map(renderFilter)}
            {hasCompactControls && (
              <Box
                sx={{
                  display: { xs: "none", md: "flex" },
                  alignItems: "center",
                  gap: spacing,
                  flex: "0 0 auto",
                }}
              >
                {nonSearchFilters.map(renderFilter)}
                {renderSortSelect()}
              </Box>
            )}

            {hasCompactControls && (
              <Box
                data-testid="entity-filter-compact-controls"
                sx={{
                  display: { xs: "flex", md: "none" },
                  gap: spacing,
                  width: "100%",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                {nonSearchFilters.map(renderCompactFilterButton)}
                {renderCompactSortButton()}
              </Box>
            )}

            <Popover
              id={compactPopoverId}
              open={Boolean(compactPopover)}
              anchorEl={compactPopover?.anchorEl ?? null}
              onClose={closeCompactPopover}
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              transformOrigin={{ vertical: "top", horizontal: "center" }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 1,
                    maxWidth: "calc(100vw - 32px)",
                    maxHeight: "calc(100vh - 32px)",
                    overflowY: "auto",
                  },
                },
              }}
            >
              {activePopoverLabel && (
                <Box role="dialog" aria-label={activePopoverLabel}>
                  {compactPopover?.control.type === "filter" && activeFilter ? (
                    <>
                      {activeFilter.type !== "custom" && (
                        <Typography variant="subtitle2" sx={{ px: 2, pt: 2 }}>
                          {activeFilter.label}
                        </Typography>
                      )}
                      {renderCompactFilterOptions(
                        activeFilter,
                        values[activeFilter.key],
                        onChange,
                        closeCompactPopover,
                        renderFilter
                      )}
                    </>
                  ) : (
                    <>
                      <Typography variant="subtitle2" sx={{ px: 2, pt: 2 }}>
                        Sort by
                      </Typography>
                      <Box role="menu" aria-label="Sort by options">
                        {sortOptions?.map((option) => (
                          <MenuItem
                            key={option.value}
                            role="menuitemradio"
                            aria-checked={sortBy === option.value}
                            selected={sortBy === option.value}
                            onClick={() => {
                              onSortChange?.(option.value);
                              closeCompactPopover();
                            }}
                          >
                            {option.label}
                          </MenuItem>
                        ))}
                      </Box>
                    </>
                  )}
                </Box>
              )}
            </Popover>
          </>
        ) : (
          <>
            {filters.map(renderFilter)}
            {renderSortSelect()}
          </>
        )}
      </Box>
    </Paper>
  );
};
