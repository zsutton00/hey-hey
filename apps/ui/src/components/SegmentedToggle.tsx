import {
  Box,
  ButtonBase,
  IconButton,
  MenuItem,
  Select,
  type SelectChangeEvent,
  type SxProps,
  type Theme,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React from "react";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";

export interface Segment<T extends string = string> {
  value: T;
  label: string;
}

interface SegmentedToggleProps<T extends string = string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  mobileDropdown?: boolean;
  scrollable?: boolean;
  sx?: SxProps<Theme>;
}

export function SegmentedToggle<T extends string = string>({
  segments,
  value,
  onChange,
  mobileDropdown = false,
  scrollable = false,
  sx,
}: SegmentedToggleProps<T>): React.ReactElement {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const sharedSx = Array.isArray(sx) ? sx : sx ? [sx] : [];

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const selectedRef = React.useRef<HTMLButtonElement>(null);
  const [scrollState, setScrollState] = React.useState({
    previous: false,
    next: false,
  });
  const dropdown = mobileDropdown && isCompact;

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!scrollable || dropdown || !viewport) return;

    const update = (): void => {
      setScrollState({
        previous: viewport.scrollLeft > 1,
        next:
          viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      });
    };
    const revealSelected = (): void => {
      const selected = selectedRef.current;
      if (selected) reveal(selected);
      update();
    };
    function reveal(element: HTMLElement): void {
      const bounds = viewport!.getBoundingClientRect();
      const item = element.getBoundingClientRect();
      if (item.left < bounds.left)
        viewport!.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        viewport!.scrollLeft += item.right - bounds.right;
    }
    revealSelected();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(revealSelected);
    observer?.observe(viewport);
    if (viewport.firstElementChild)
      observer?.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", revealSelected);
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", revealSelected);
    };
  }, [scrollable, dropdown, value, segments]);

  const scroll = (direction: number): void => {
    const viewport = viewportRef.current;
    if (viewport)
      viewport.scrollBy({
        left: direction * viewport.clientWidth * 0.8,
        behavior: "smooth",
      });
  };

  if (dropdown) {
    const selectedSegment = segments.find((segment) => segment.value === value);

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

  const pills = (
    <Box
      sx={[
        {
          display: "inline-flex",
          borderRadius: 2,
          bgcolor: "action.hover",
          p: 0.5,
          gap: 0.5,
          ...(scrollable ? { width: "max-content", flexWrap: "nowrap" } : {}),
        },
        ...(!scrollable ? sharedSx : []),
      ]}
    >
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <ButtonBase
            key={segment.value}
            ref={isActive ? selectedRef : undefined}
            aria-pressed={isActive}
            onFocus={(event) => {
              const viewport = viewportRef.current;
              if (!scrollable || !viewport) return;
              const bounds = viewport.getBoundingClientRect();
              const item = event.currentTarget.getBoundingClientRect();
              if (item.left < bounds.left)
                viewport.scrollLeft += item.left - bounds.left;
              else if (item.right > bounds.right)
                viewport.scrollLeft += item.right - bounds.right;
            }}
            onClick={() => onChange(segment.value)}
            disableRipple
            sx={{
              ...(scrollable ? { flexShrink: 0, whiteSpace: "nowrap" } : {}),
              px: 2.5,
              py: 0.75,
              borderRadius: 1.5,
              fontSize: "0.8125rem",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "text.primary" : "text.secondary",
              bgcolor: isActive ? "background.paper" : "transparent",
              boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 150ms ease",
              "&.Mui-focusVisible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: -2,
              },
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
  if (!scrollable) return pills;

  const overflowing = scrollState.previous || scrollState.next;
  return (
    <Box
      sx={[
        {
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          maxWidth: "100%",
          width: "fit-content",
          gap: 0.5,
        },
        ...sharedSx,
      ]}
    >
      {overflowing && (
        <IconButton
          aria-label="Previous types"
          size="small"
          disabled={!scrollState.previous}
          onClick={() => scroll(-1)}
        >
          <ChevronLeft />
        </IconButton>
      )}
      <Box
        ref={viewportRef}
        sx={{ minWidth: 0, overflowX: "auto", overscrollBehaviorX: "contain" }}
      >
        {pills}
      </Box>
      {overflowing && (
        <IconButton
          aria-label="Next types"
          size="small"
          disabled={!scrollState.next}
          onClick={() => scroll(1)}
        >
          <ChevronRight />
        </IconButton>
      )}
    </Box>
  );
}
