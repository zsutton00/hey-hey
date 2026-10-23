import CloseIcon from "@mui/icons-material/Close";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import React, { useEffect, useRef } from "react";
import type { EntityListItemProps } from "../../Entity/EntityListItem";
import { EntityListItem } from "../../Entity/EntityListItem";
import { EntityHoverCard } from "../EntityHoverCard";

const ENTITY_COLLECTION_SORT_OPTIONS = [
  { value: "name-asc", label: "Name, A–Z" },
  { value: "name-desc", label: "Name, Z–A" },
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
] as const;

export type EntityCollectionSort =
  (typeof ENTITY_COLLECTION_SORT_OPTIONS)[number]["value"];

export interface EntityCollectionPickerRow {
  entityId: string;
  entityType: string;
  entityName: string;
  listItemProps: EntityListItemProps;
}

export type EntityCollectionPickerStatus =
  "loading" | "error" | "empty" | "ready" | "updating";

interface EntityCollectionPickerDialogProps {
  testIdPrefix: string;
  dialogTestId?: string;
  organizationId: string;
  projectId: string;
  title: string;
  searchLabel: string;
  errorMessage: string;
  updatingLabel?: string;
  rows: readonly EntityCollectionPickerRow[];
  status: EntityCollectionPickerStatus;
  filter: string;
  sort: EntityCollectionSort;
  page: number;
  totalPages: number;
  additionalFilters?: React.ReactNode;
  titleAction?: React.ReactNode;
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: EntityCollectionSort) => void;
  onPageChange: (page: number) => void;
  onClose: () => void;
  onSelect: (row: EntityCollectionPickerRow) => void;
  onPreview?: (row: EntityCollectionPickerRow) => void;
}

const isEntityCollectionSort = (value: string): value is EntityCollectionSort =>
  ENTITY_COLLECTION_SORT_OPTIONS.some((option) => option.value === value);

export const EntityCollectionPickerDialog: React.FC<
  EntityCollectionPickerDialogProps
> = ({
  testIdPrefix,
  dialogTestId,
  organizationId,
  projectId,
  title,
  searchLabel,
  errorMessage,
  updatingLabel,
  rows,
  status,
  filter,
  sort,
  page,
  totalPages,
  additionalFilters,
  titleAction,
  onFilterChange,
  onSortChange,
  onPageChange,
  onClose,
  onSelect,
  onPreview,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [hoverAnchor, setHoverAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const [hoveredRow, setHoveredRow] =
    React.useState<EntityCollectionPickerRow | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const clearHover = (): void => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverAnchor(null);
    setHoveredRow(null);
  };

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    },
    [],
  );

  const handleSortChange = (event: SelectChangeEvent): void => {
    if (isEntityCollectionSort(event.target.value)) {
      onSortChange(event.target.value);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={fullScreen}
      data-testid={dialogTestId ?? `${testIdPrefix}-picker`}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {title}
        {titleAction}
        <IconButton
          aria-label={`Close ${title.toLowerCase()}`}
          data-testid={`close-${testIdPrefix}-picker`}
          onClick={onClose}
          sx={{ ml: "auto" }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 0 }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <TextField
              label={searchLabel}
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              fullWidth
              inputProps={{ "data-testid": `${testIdPrefix}-filter` }}
            />
            {additionalFilters}
            <FormControl fullWidth>
              <InputLabel id={`${testIdPrefix}-sort-label`}>Sort</InputLabel>
              <Select
                labelId={`${testIdPrefix}-sort-label`}
                label="Sort"
                value={sort}
                onChange={handleSortChange}
                inputProps={{ "data-testid": `${testIdPrefix}-sort` }}
              >
                {ENTITY_COLLECTION_SORT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          {status === "loading" && (
            <Box data-testid={`${testIdPrefix}-loading`} sx={{ py: 4 }}>
              <LinearProgress aria-label={`Loading ${title.toLowerCase()}`} />
            </Box>
          )}
          {status === "error" && (
            <Alert severity="error" data-testid={`${testIdPrefix}-error`}>
              {errorMessage}
            </Alert>
          )}
          {status === "empty" && (
            <Typography
              color="text.secondary"
              textAlign="center"
              data-testid={`${testIdPrefix}-empty`}
              sx={{ py: 4 }}
            >
              No matches found
            </Typography>
          )}
          {rows.length > 0 && (
            <Box
              data-testid={`${testIdPrefix}-results`}
              sx={{ minWidth: 0, overflowX: "hidden" }}
            >
              {rows.map((row) => (
                <Box
                  key={row.entityId}
                  data-testid={`${testIdPrefix}-row`}
                  data-entity-id={row.entityId}
                  onMouseEnter={(event) => {
                    const anchor = event.currentTarget;
                    if (hoverTimerRef.current !== null) {
                      window.clearTimeout(hoverTimerRef.current);
                    }
                    hoverTimerRef.current = window.setTimeout(() => {
                      setHoverAnchor(anchor);
                      setHoveredRow(row);
                      hoverTimerRef.current = null;
                    }, 300);
                  }}
                  onMouseLeave={clearHover}
                  sx={{
                    borderBottom: 1,
                    borderColor: "divider",
                    "&:last-of-type": { borderBottom: 0 },
                  }}
                >
                  <EntityListItem
                    {...row.listItemProps}
                    onClick={() => onSelect(row)}
                    attentionContent={
                      onPreview ? (
                        <Tooltip title={`Preview ${row.entityName}`}>
                          <IconButton
                            aria-label={`Preview ${row.entityName}`}
                            data-testid={`${testIdPrefix}-preview`}
                            size="small"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onPreview(row);
                            }}
                          >
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : undefined
                    }
                  />
                </Box>
              ))}
            </Box>
          )}
          <Box
            data-testid={`${testIdPrefix}-update-progress-slot`}
            sx={{ height: 4 }}
          >
            <LinearProgress
              aria-label={updatingLabel ?? `Updating ${title.toLowerCase()}`}
              sx={{ visibility: status === "updating" ? "visible" : "hidden" }}
            />
          </Box>
          {totalPages > 1 && (
            <Pagination
              page={page}
              count={totalPages}
              onChange={(_event, nextPage) => onPageChange(nextPage)}
              disabled={status === "updating"}
              showFirstButton
              showLastButton
              sx={{ alignSelf: "center" }}
              data-testid={`${testIdPrefix}-pagination`}
            />
          )}
        </Stack>
      </DialogContent>
      {hoverAnchor && hoveredRow && (
        <EntityHoverCard
          entityId={hoveredRow.entityId}
          entityType={hoveredRow.entityType}
          organizationId={organizationId}
          projectId={projectId}
          anchorEl={hoverAnchor}
          placement="right-start"
          onPopoverMouseEnter={() => {
            if (hoverTimerRef.current !== null) {
              window.clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = null;
            }
          }}
          onPopoverMouseLeave={clearHover}
        />
      )}
    </Dialog>
  );
};
