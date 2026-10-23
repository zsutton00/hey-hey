import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import {
  Box,
  ClickAwayListener,
  CircularProgress,
  Collapse,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  OutlinedInput,
  Paper,
  Popper,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TaskResponseDto } from "../../api";
import {
  useFeatureHierarchy,
  useFeatureLookup,
  type FeatureHierarchyNode,
} from "../../data/hooks/useFeatureHierarchy";
import { useFeatureDocumentContent } from "../../data/hooks/useFeatureDocumentContent";
import { getWorkItemSectionContent } from "../../utils/workItemSections";

const FEATURE_TITLE_RESULT_LIMIT = 20;
const EMPTY_FEATURE_IDS: string[] = [];

type PickerInputSlotProps = {
  value?: string;
  style?: React.CSSProperties;
  className?: string;
};

const PickerInputSlot = React.forwardRef<HTMLDivElement, PickerInputSlotProps>(
  function PickerInputSlot({ value, style, className }, ref) {
    return (
      <div
        ref={ref}
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          flex: 1,
          minWidth: 0,
          padding: "16.5px 14px",
        }}
        className={className}
      >
        {value}
      </div>
    );
  }
);

const getDisplayName = (feature: { name: string }): string => feature.name;

interface FeatureTreeNodeProps {
  node: FeatureHierarchyNode;
  level: number;
  selectedId: string | null;
  onSelect: (feature: TaskResponseDto) => void;
  organizationId: string;
  projectId: string;
  exclusionSet: Set<string>;
}

const FeatureTreeNode: React.FC<FeatureTreeNodeProps> = ({
  node,
  level,
  selectedId,
  onSelect,
  organizationId,
  projectId,
  exclusionSet,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { entries: metadata } = useFeatureDocumentContent(
    organizationId,
    projectId,
    [node.feature.id],
    undefined,
    "metadata"
  );
  const { entries: documents } = useFeatureDocumentContent(
    organizationId,
    projectId,
    [node.feature.id]
  );
  const feature = node.feature;
  const selected = metadata.get(feature.id)?.data;
  const document = documents.get(feature.id);
  const description = getWorkItemSectionContent(
    document?.data?.sections,
    "description"
  );
  const children = node.children.filter(
    (child) => !exclusionSet.has(child.feature.id)
  );
  return (
    <Box>
      <ListItemButton
        data-testid="feature-picker-option"
        data-feature-id={feature.id}
        aria-disabled={!selected}
        role="option"
        aria-selected={selectedId === feature.id}
        selected={selectedId === feature.id}
        sx={{ pl: 1 + level * 2.5 }}
        onClick={() => {
          if (selected) onSelect(selected);
        }}
        dense
      >
        <Box component="span" sx={{ mr: 0.5, width: 20 }}>
          {node.children.length > 0 && (
            <IconButton
              size="small"
              data-testid="feature-picker-expand"
              data-feature-id={feature.id}
              aria-label={`Drill into ${feature.name}`}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((previous) => !previous);
              }}
              sx={{ p: 0.25 }}
            >
              <ChevronRightIcon
                sx={{
                  fontSize: 18,
                  transform: expanded ? "rotate(90deg)" : "none",
                }}
              />
            </IconButton>
          )}
        </Box>
        <ListItemText
          primary={feature.name}
          primaryTypographyProps={{ variant: "body2" }}
          secondaryTypographyProps={{
            variant: "caption",
            sx: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          }}
          secondary={
            !selected
              ? metadata.get(feature.id)?.status === "error"
                ? "Feature unavailable"
                : "Loading feature…"
              : description ||
                (document?.status === "error"
                  ? "Failed to load description"
                  : document?.status === "ready"
                  ? undefined
                  : "Loading description…")
          }
        />
      </ListItemButton>
      <Collapse in={expanded} unmountOnExit>
        {children.map((child) => (
          <FeatureTreeNode
            key={child.feature.id}
            node={child}
            level={level + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            organizationId={organizationId}
            projectId={projectId}
            exclusionSet={exclusionSet}
          />
        ))}
      </Collapse>
    </Box>
  );
};

export interface FeaturePickerProps {
  organizationId: string;
  projectId: string;
  label?: string;
  placeholder?: string;
  helperText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  sx?: SxProps<Theme>;
  excludeFeatureIds?: string[];
  searchable?: boolean;
  openOnMount?: boolean;
  onClose?: () => void;
  value: string | null;
  onChange: (featureId: string | null, feature?: TaskResponseDto) => void;
}

export const FeaturePicker: React.FC<FeaturePickerProps> = ({
  organizationId,
  projectId,
  label = "Feature",
  placeholder: _placeholder = "Select a feature",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  excludeFeatureIds = EMPTY_FEATURE_IDS,
  searchable = false,
  openOnMount = false,
  onClose,
  value,
  onChange,
}) => {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const hierarchy = useFeatureHierarchy(organizationId, projectId);
  const lookup = useFeatureLookup(organizationId, projectId);
  const isLoadingRoot = hierarchy.isLoading;
  const rootError = hierarchy.error;
  const isLoadingSearch = hierarchy.isLoading;
  const searchError = hierarchy.error;
  const [searchQuery, setSearchQuery] = useState("");
  const exclusionSet = useMemo(
    () => new Set(excludeFeatureIds.filter(Boolean)),
    [excludeFeatureIds]
  );
  const visibleRoot = hierarchy.roots.filter(
    (node) => !exclusionSet.has(node.feature.id)
  );
  const projectFeatures = useMemo(
    () => [...hierarchy.nodes.values()].map((node) => node.feature),
    [hierarchy.nodes]
  );

  const handleOpen = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (disabled) return;
      setAnchorEl(e.currentTarget);
    },
    [disabled]
  );

  const handleClose = useCallback(() => {
    setAnchorEl(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!anchorEl) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [anchorEl, handleClose]);

  useEffect(() => {
    if (!openOnMount || disabled) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      if (triggerRef.current) setAnchorEl(triggerRef.current);
      if (searchable) searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [disabled, openOnMount, searchable]);

  const handleSelect = useCallback(
    (feature: TaskResponseDto) => {
      onChange(feature.id, feature);
      handleClose();
    },
    [onChange, handleClose]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
    },
    [onChange]
  );

  const handleSearchClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchQuery("");
  }, []);

  const open = Boolean(anchorEl);
  const hasValue = value !== null;
  const isDisabled = disabled;
  const shouldShrinkLabel =
    hasValue || open || (searchable && searchQuery.length > 0);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(
    () =>
      normalizedSearchQuery
        ? projectFeatures
            .filter(
              (feature) =>
                !exclusionSet.has(feature.id) &&
                getDisplayName(feature)
                  .toLowerCase()
                  .includes(normalizedSearchQuery)
            )
            .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)))
            .slice(0, FEATURE_TITLE_RESULT_LIMIT)
        : [],
    [exclusionSet, normalizedSearchQuery, projectFeatures]
  );

  const visibleSearchIds = open
    ? searchResults.map((feature) => feature.id)
    : [];
  const { entries: searchMetadata } = useFeatureDocumentContent(
    organizationId,
    projectId,
    visibleSearchIds,
    undefined,
    "metadata"
  );
  const { entries: searchDocuments } = useFeatureDocumentContent(
    organizationId,
    projectId,
    visibleSearchIds
  );
  const triggerLabel = value
    ? lookup.get(value)?.name ??
      (hierarchy.isLoading ? "Loading feature…" : "Feature unavailable")
    : "";

  const popoverWidth = triggerRef.current?.offsetWidth ?? 360;

  const computedHelperText = rootError?.message || helperText || "";

  return (
    <ClickAwayListener
      onClickAway={() => {
        if (open) handleClose();
      }}
    >
      <FormControl
        ref={triggerRef}
        fullWidth={fullWidth}
        error={error || !!rootError}
        disabled={isDisabled}
        size={size}
        sx={sx}
      >
        <InputLabel shrink={shouldShrinkLabel}>{label}</InputLabel>
        <OutlinedInput
          autoFocus={searchable && openOnMount}
          inputRef={searchable ? searchInputRef : undefined}
          notched={shouldShrinkLabel}
          label={label}
          inputComponent={
            searchable ? undefined : (PickerInputSlot as unknown as "input")
          }
          inputProps={
            searchable
              ? {
                  "aria-autocomplete": "list",
                  "aria-controls": open ? listboxId : undefined,
                  "aria-expanded": open,
                  "aria-haspopup": "listbox",
                  "aria-label": "Search feature titles",
                  role: "combobox",
                }
              : undefined
          }
          placeholder={searchable ? "Search feature titles" : undefined}
          value={searchable ? searchQuery : triggerLabel}
          onChange={
            searchable
              ? (event) => {
                  setSearchQuery(event.target.value);
                  if (!anchorEl && triggerRef.current) {
                    setAnchorEl(triggerRef.current);
                  }
                }
              : undefined
          }
          onClick={isDisabled ? undefined : handleOpen}
          onKeyDown={(e) => {
            if (isDisabled) return;
            if (!searchable && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setAnchorEl(e.currentTarget);
            }
          }}
          sx={{
            cursor: isDisabled ? "default" : searchable ? "text" : "pointer",
          }}
          slotProps={
            searchable
              ? undefined
              : {
                  root: {
                    role: "button",
                    "aria-label": label,
                    "aria-haspopup": "listbox",
                    "aria-expanded": open,
                    tabIndex: isDisabled ? -1 : 0,
                  } as React.ComponentPropsWithRef<"div">,
                }
          }
          endAdornment={
            <InputAdornment position="end" sx={{ gap: 0.25 }}>
              {searchable && searchQuery && !isDisabled ? (
                <IconButton
                  size="small"
                  onClick={handleSearchClear}
                  aria-label="Clear feature search"
                  sx={{ p: 0.25 }}
                >
                  <ClearIcon sx={{ fontSize: 14 }} />
                </IconButton>
              ) : hasValue && !isDisabled ? (
                <IconButton
                  size="small"
                  onClick={handleClear}
                  aria-label="Clear selection"
                  sx={{ p: 0.25 }}
                >
                  <ClearIcon sx={{ fontSize: 14 }} />
                </IconButton>
              ) : null}
              {searchable && normalizedSearchQuery && isLoadingSearch && (
                <CircularProgress size={16} aria-label="Searching features" />
              )}
              <ArrowDropDownIcon
                sx={{
                  fontSize: 20,
                  color: "action.active",
                  transform: open ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                  mr: -0.5,
                  pointerEvents: "none",
                }}
              />
            </InputAdornment>
          }
        />
        {computedHelperText && (
          <Typography
            variant="caption"
            color={error || rootError ? "error" : "text.secondary"}
            sx={{ display: "block", mt: 0.5, ml: 1 }}
          >
            {computedHelperText}
          </Typography>
        )}
        <Popper
          open={open}
          anchorEl={anchorEl}
          placement="bottom-start"
          sx={{
            zIndex: (theme) => theme.zIndex.modal + 1,
          }}
        >
          <Paper
            elevation={8}
            sx={{ width: popoverWidth, maxHeight: 420, overflow: "auto" }}
          >
            <List id={listboxId} dense disablePadding role="listbox">
              {normalizedSearchQuery ? (
                searchResults.length > 0 ? (
                  searchResults.map((feature) => (
                    <ListItemButton
                      key={feature.id}
                      role="option"
                      disabled={!searchMetadata.get(feature.id)?.data}
                      data-testid="feature-picker-search-option"
                      data-feature-id={feature.id}
                      aria-selected={value === feature.id}
                      selected={value === feature.id}
                      onClick={() => {
                        const selected = searchMetadata.get(feature.id)?.data;
                        if (selected) handleSelect(selected);
                      }}
                      dense
                    >
                      <ListItemText
                        primary={getDisplayName(feature)}
                        secondary={getWorkItemSectionContent(
                          searchDocuments.get(feature.id)?.data?.sections,
                          "description"
                        )}
                        primaryTypographyProps={{ variant: "body2" }}
                        secondaryTypographyProps={{
                          variant: "caption",
                          sx: {
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        }}
                      />
                    </ListItemButton>
                  ))
                ) : isLoadingSearch ? (
                  <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : (
                  <Box sx={{ p: 2 }}>
                    <Typography
                      variant="body2"
                      color={searchError ? "error" : "text.secondary"}
                    >
                      {searchError
                        ? "Failed to search features"
                        : "No matching features"}
                    </Typography>
                  </Box>
                )
              ) : isLoadingRoot ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                  <CircularProgress size={20} />
                </Box>
              ) : visibleRoot.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    No features found
                  </Typography>
                </Box>
              ) : (
                visibleRoot.map((feature) => (
                  <FeatureTreeNode
                    key={feature.feature.id}
                    node={feature}
                    level={0}
                    selectedId={value}
                    onSelect={handleSelect}
                    organizationId={organizationId}
                    projectId={projectId}
                    exclusionSet={exclusionSet}
                  />
                ))
              )}
            </List>
          </Paper>
        </Popper>
      </FormControl>
    </ClickAwayListener>
  );
};
