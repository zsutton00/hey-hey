import {
  Box,
  ButtonBase,
  MenuItem,
  Select,
  type Breakpoint,
  type SelectChangeEvent,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React from "react";

export interface PaneToggleSegment<T extends string> {
  value: T;
  label: string;
}

export interface PaneToggleProps<T extends string> {
  segments: readonly PaneToggleSegment<T>[];
  visibleValues: readonly T[];
  onChange: (visible: readonly T[]) => void;
  ariaLabel: string;
  /** Below this width the control becomes a pick-one dropdown. */
  compactBelow?: Breakpoint;
}

export function PaneToggle<T extends string>({
  segments,
  visibleValues,
  onChange,
  ariaLabel,
  compactBelow = "md",
}: PaneToggleProps<T>): React.ReactElement {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down(compactBelow));

  const shown = segments.filter((segment) =>
    visibleValues.includes(segment.value),
  );

  const handleToggle = (value: T): void => {
    const isOn = visibleValues.includes(value);

    if (isOn && shown.length === 1) {
      return;
    }

    const next = segments
      .map((segment) => segment.value)
      .filter((candidate) =>
        candidate === value ? !isOn : visibleValues.includes(candidate),
      );
    onChange(next);
  };

  if (isCompact) {
    const selectedValue = shown.length === 1 ? shown[0].value : "";

    return (
      <Box sx={{ width: "100%" }}>
        <Select<string>
          fullWidth
          size="small"
          displayEmpty
          value={selectedValue}
          data-testid="pane-toggle-dropdown"
          onChange={(event: SelectChangeEvent<string>) => {
            const picked = segments.find(
              (segment) => segment.value === event.target.value,
            );
            if (picked) {
              onChange([picked.value]);
            }
          }}
          renderValue={() => shown.map((segment) => segment.label).join(" + ")}
          inputProps={{ "aria-label": ariaLabel }}
          sx={{
            borderRadius: 2,
            bgcolor: "action.hover",
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
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
      role="group"
      aria-label={ariaLabel}
      data-testid="pane-toggle"
      sx={{
        display: "inline-flex",
        borderRadius: 2,
        bgcolor: "action.hover",
        p: 0.5,
        gap: 0.5,
      }}
    >
      {segments.map((segment) => {
        const isOn = visibleValues.includes(segment.value);
        const isLastOn = isOn && shown.length === 1;

        return (
          <ButtonBase
            key={segment.value}
            aria-pressed={isOn}
            aria-disabled={isLastOn}
            data-testid="pane-toggle-segment"
            data-value={segment.value}
            onClick={() => handleToggle(segment.value)}
            disableRipple
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              px: 2.5,
              py: 0.75,
              borderRadius: 1.5,
              fontSize: "0.8125rem",
              fontWeight: isOn ? 600 : 400,
              color: isOn ? "text.primary" : "text.secondary",
              bgcolor: isOn ? "background.paper" : "transparent",
              boxShadow: isOn ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              cursor: isLastOn ? "not-allowed" : "pointer",
              transition: "all 150ms ease",
              "&.Mui-focusVisible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: -2,
              },
              "&:hover": {
                bgcolor: isOn ? "background.paper" : "action.selected",
              },
            }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                boxSizing: "border-box",
                flexShrink: 0,
                borderRadius: "50%",
                border: "2px solid",
                borderColor: isOn ? "primary.main" : "text.disabled",
                bgcolor: isOn ? "primary.main" : "transparent",
              }}
            />
            {segment.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
