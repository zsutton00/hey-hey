import React, { useCallback, useId, useMemo } from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import ClearIcon from "@mui/icons-material/Clear";
import type { DesignDocResponseDto } from "../../api";
import { useDesignDocs } from "../../data/hooks/useDesignDocs";

const NO_SELECTION_VALUE = "__design_doc_selector_no_value__";
const NONE_VALUE = "__design_doc_selector_none__";

export interface DesignDocSelectorProps {
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
  excludeDesignDocIds?: string[];
  includeNone?: boolean;
  value: string | null;
  onChange: (
    designDocId: string | null,
    designDoc?: DesignDocResponseDto
  ) => void;
}

const getDisplayName = (designDoc: DesignDocResponseDto): string => {
  if (designDoc.name && designDoc.name.trim().length > 0) {
    return designDoc.name;
  }
  return "Untitled document";
};

export const DesignDocSelector: React.FC<DesignDocSelectorProps> = ({
  organizationId,
  projectId,
  label = "Design Document",
  placeholder = "Select a design document",
  helperText,
  fullWidth = true,
  disabled = false,
  size = "small",
  error = false,
  sx,
  excludeDesignDocIds = [],
  includeNone = false,
  value,
  onChange,
}) => {
  const labelId = useId();
  const selectId = useId();

  const {
    designDocs: allDesignDocs,
    isLoading,
    error: fetchError,
  } = useDesignDocs(organizationId, {
    projectId,
    enabled: Boolean(organizationId && projectId),
  });

  const designDocs = useMemo(() => {
    const exclusionSet = new Set(
      excludeDesignDocIds.filter((id): id is string => Boolean(id))
    );

    return allDesignDocs
      .filter((doc) => !exclusionSet.has(doc.id))
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
  }, [allDesignDocs, excludeDesignDocIds]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const rawValue = event.target.value;
      if (rawValue === NONE_VALUE) {
        onChange(null);
        return;
      }
      if (rawValue === NO_SELECTION_VALUE) {
        onChange(null);
        return;
      }

      const selectedDoc = designDocs.find((doc) => doc.id === rawValue);
      onChange(rawValue, selectedDoc);
    },
    [onChange, designDocs]
  );

  const handleClear = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onChange(null);
    },
    [onChange]
  );

  const renderValue = useCallback(
    (selected: unknown) => {
      const selectedId = String(selected);

      if (selectedId === NO_SELECTION_VALUE) {
        return (
          <Typography color="text.secondary" variant="body2">
            {placeholder}
          </Typography>
        );
      }

      if (includeNone && (selectedId === NONE_VALUE || !selectedId)) {
        return (
          <Typography variant="body2" color="text.secondary">
            None
          </Typography>
        );
      }

      const doc = allDesignDocs.find((item) => item.id === selectedId);
      return (
        <Typography variant="body2">
          {doc ? getDisplayName(doc) : placeholder}
        </Typography>
      );
    },
    [allDesignDocs, placeholder, includeNone]
  );

  const computedHelperText =
    fetchError?.message ||
    (isLoading ? "Loading design documents…" : helperText) ||
    "";

  const shouldShowHelperText = Boolean(computedHelperText);
  const hasValue = value !== null;
  const isDisabled = disabled || isLoading;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={isDisabled}
      size={size}
      error={error || Boolean(fetchError)}
      sx={sx}
    >
      <InputLabel id={`${labelId}-label`}>{label}</InputLabel>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Select
          labelId={`${labelId}-label`}
          id={`${selectId}-select`}
          value={value ?? NO_SELECTION_VALUE}
          label={label}
          onChange={handleChange}
          displayEmpty
          renderValue={renderValue}
          MenuProps={{
            PaperProps: { sx: { maxHeight: 320 } },
          }}
          sx={{ flex: 1 }}
        >
          <MenuItem value={NO_SELECTION_VALUE} disabled>
            {placeholder}
          </MenuItem>
          {includeNone && (
            <MenuItem value={NONE_VALUE}>
              <Typography variant="body2" color="text.secondary">
                None
              </Typography>
            </MenuItem>
          )}
          {designDocs.map((doc) => (
            <MenuItem key={doc.id} value={doc.id}>
              <Box sx={{ display: "flex", flexDirection: "column" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {getDisplayName(doc)}
                </Typography>
                {doc.status && (
                  <Typography variant="caption" color="text.secondary">
                    Status: {doc.status}
                  </Typography>
                )}
              </Box>
            </MenuItem>
          ))}
          {isLoading && (
            <MenuItem disabled>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            </MenuItem>
          )}
        </Select>
        {!includeNone && hasValue && !isDisabled && (
          <IconButton
            size="small"
            onClick={handleClear}
            sx={{ mt: size === "small" ? 0.5 : 1 }}
            aria-label="Clear selection"
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      {shouldShowHelperText && (
        <FormHelperText>{computedHelperText}</FormHelperText>
      )}
    </FormControl>
  );
};
