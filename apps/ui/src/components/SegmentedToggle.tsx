import {
  Box,
  ButtonBase,
  MenuItem,
  Select,
  type SelectChangeEvent,
  type SxProps,
  type Theme,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React from "react";

export interface Segment<T extends string = string> {
  value: T;
  label: string;
}

interface SegmentedToggleProps<T extends string = string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  mobileDropdown?: boolean;
  sx?: SxProps<Theme>;
}

export function SegmentedToggle<T extends string = string>({
  segments,
  value,
  onChange,
  mobileDropdown = false,
  sx,
}: SegmentedToggleProps<T>): React.ReactElement {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const sharedSx = Array.isArray(sx) ? sx : sx ? [sx] : [];

  if (mobileDropdown && isCompact) {
    const selectedSegment = segments.find(
      (segment) => segment.value === value,
    );

    return (
      <Box
        sx={[
          {
            width: "100%",
          },
          ...sharedSx,
        ]}
      >
        <Select<T>
          fullWidth
          size="small"
          value={value}
          onChange={(event: SelectChangeEvent<T>) => {
            const nextValue = event.target.value as T;
            if (segments.some((segment) => segment.value === nextValue)) {
              onChange(nextValue);
            }
          }}
          renderValue={() => selectedSegment?.label ?? String(value)}
          inputProps={{ "aria-label": "Select view" }}
          sx={{
            borderRadius: 2,
            bgcolor: "action.hover",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "divider",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "text.secondary",
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "primary.main",
              borderWidth: 1,
            },
            "& .MuiSelect-select": {
              py: 1,
              px: 1.5,
              fontSize: "0.8125rem",
              fontWeight: 600,
            },
          }}
        >
          {segments.map((segment) => (
            <MenuItem key={segment.value} value={segment.value}>
              {segment.label}
            </MenuItem>
          ))}
        </Select>
      </Box>
    );
  }

  return (
    <Box
      sx={[
        {
          display: "inline-flex",
          borderRadius: 2,
          bgcolor: "action.hover",
          p: 0.5,
          gap: 0.5,
        },
        ...sharedSx,
      ]}
    >
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <ButtonBase
            key={segment.value}
            onClick={() => onChange(segment.value)}
            disableRipple
            sx={{
              px: 2.5,
              py: 0.75,
              borderRadius: 1.5,
              fontSize: "0.8125rem",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "text.primary" : "text.secondary",
              bgcolor: isActive ? "background.paper" : "transparent",
              boxShadow: isActive
                ? "0 1px 3px rgba(0,0,0,0.08)"
                : "none",
              transition: "all 150ms ease",
              "&:hover": {
                bgcolor: isActive ? "background.paper" : "action.selected",
              },
            }}
          >
            {segment.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
