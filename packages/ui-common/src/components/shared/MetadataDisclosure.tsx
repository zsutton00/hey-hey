import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  Box,
  Chip,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { MouseEvent } from "react";
import { useId, useState } from "react";
import type { SxProps, Theme } from "@mui/material/styles";

export interface MetadataDisclosureValueRow {
  label: string;
  value: string;
  testId?: string;
  mobileTestId?: string;
  desktopTestId?: string;
  onCopy?: never;
}

export interface MetadataDisclosureCopyRow {
  label: string;
  value: string;
  testId?: string;
  mobileTestId?: string;
  desktopTestId?: string;
  onCopy: () => void;
}

export type MetadataDisclosureRow =
  | MetadataDisclosureValueRow
  | MetadataDisclosureCopyRow;

export type MetadataDisclosureBreakpoint = "sm" | "md";
export type MetadataDisclosureDesktopJustify = "flex-start" | "flex-end";
export type MetadataDisclosureDesktopChipVariant = "default" | "muted";

export interface MetadataDisclosureMobileTrigger {
  primaryRow: MetadataDisclosureRow;
  closedAriaLabel: string;
  openAriaLabel: string;
}

export interface MetadataDisclosureProps {
  rows: readonly MetadataDisclosureRow[];
  title: string;
  testIdPrefix: string;
  mobileBreakpoint: MetadataDisclosureBreakpoint;
  mobileTrigger: MetadataDisclosureMobileTrigger;
  desktopJustifyContent?: MetadataDisclosureDesktopJustify;
  desktopChipVariant?: MetadataDisclosureDesktopChipVariant;
  dataPlacement?: string;
  sx?: SxProps<Theme>;
  forceCompact?: boolean;
}

const chipSx = {
  maxWidth: "100%",
  minWidth: 0,
  "& .MuiChip-label": {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
} as const;

const compactChipSx = {
  maxWidth: "100%",
  minWidth: 0,
  height: "auto",
  "& .MuiChip-label": {
    py: 0.5,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
} as const;

const hasDisplayValue = (value: string): boolean => value.trim().length > 0;

export const MetadataDisclosure = ({
  rows,
  title,
  testIdPrefix,
  mobileBreakpoint,
  mobileTrigger,
  desktopJustifyContent = "flex-end",
  desktopChipVariant = "default",
  dataPlacement,
  sx,
  forceCompact = false,
}: MetadataDisclosureProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(mobileBreakpoint));
  const [mobileDetailsAnchor, setMobileDetailsAnchor] =
    useState<HTMLElement | null>(null);
  const mobileDetailsId = useId();
  const mobileDetailsTitleId = useId();

  const displayRows = rows.filter((row) => hasDisplayValue(row.value));
  const mobileDetailsOpen = mobileDetailsAnchor !== null;
  const desktopChipVariantSx =
    desktopChipVariant === "muted"
      ? {
          backgroundColor: (theme: Theme) =>
            theme.palette.mode === "dark" ? "grey.800" : "grey.200",
          color: "text.primary",
          border: "none",
        }
      : {};

  if (displayRows.length === 0) {
    return null;
  }

  const handleMobileTriggerClick = (event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    setMobileDetailsAnchor(mobileDetailsOpen ? null : event.currentTarget);
  };

  return (
    <Box data-placement={dataPlacement} data-testid={testIdPrefix} sx={sx}>
      {forceCompact || isMobile ? (
        <>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ width: "100%", minWidth: 0 }}
          >
            <Chip
              aria-controls={mobileDetailsId}
              aria-expanded={mobileDetailsOpen}
              aria-haspopup="dialog"
              aria-label={
                mobileDetailsOpen
                  ? mobileTrigger.openAriaLabel
                  : mobileTrigger.closedAriaLabel
              }
              clickable
              component="button"
              data-testid={`${testIdPrefix}-mobile-primary`}
              label={mobileTrigger.primaryRow.value}
              onClick={handleMobileTriggerClick}
              size="small"
              sx={compactChipSx}
              type="button"
            />
            <Tooltip
              title={mobileDetailsOpen ? "Hide more details" : "Show more details"}
              arrow
            >
              <IconButton
                aria-controls={mobileDetailsId}
                aria-expanded={mobileDetailsOpen}
                aria-haspopup="dialog"
                aria-label={
                  mobileDetailsOpen
                    ? mobileTrigger.openAriaLabel
                    : mobileTrigger.closedAriaLabel
                }
                data-testid={`${testIdPrefix}-mobile-toggle`}
                onClick={handleMobileTriggerClick}
                size="small"
                sx={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  color: "text.secondary",
                }}
              >
                <InfoOutlinedIcon />
              </IconButton>
            </Tooltip>
          </Stack>
          <Popover
            id={mobileDetailsId}
            open={mobileDetailsOpen}
            anchorEl={mobileDetailsAnchor}
            onClose={() => setMobileDetailsAnchor(null)}
            disableScrollLock
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{
              paper: {
                sx: {
                  width: "min(320px, calc(100vw - 24px))",
                  maxWidth: "calc(100vw - 24px)",
                  maxHeight: "calc(100vh - 32px)",
                  overflowY: "auto",
                  p: 2,
                },
              },
            }}
          >
            <Box
              role="dialog"
              aria-labelledby={mobileDetailsTitleId}
              data-testid={`${testIdPrefix}-mobile-details`}
              sx={{ minWidth: 0, maxWidth: "100%" }}
            >
              <Typography
                id={mobileDetailsTitleId}
                component="h2"
                variant="subtitle2"
                sx={{ mb: 1 }}
              >
                {title}
              </Typography>
              <Stack component="dl" spacing={1} sx={{ m: 0 }}>
                {displayRows.map((row, index) => (
                  <Box
                    component="div"
                    key={`${row.label}-${index}`}
                    data-testid={row.mobileTestId ?? row.testId}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)",
                      gap: 1,
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      component="dt"
                      variant="caption"
                      color="text.secondary"
                    >
                      {row.label}
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      sx={{ m: 0, minWidth: 0, overflowWrap: "anywhere" }}
                    >
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Popover>
        </>
      ) : (
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          justifyContent={desktopJustifyContent}
          flexWrap="nowrap"
          data-testid={`${testIdPrefix}-desktop`}
          sx={{
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {displayRows.map((row, index) => (
            <Tooltip key={`${row.label}-${index}`} title={row.label} arrow>
              <Chip
                aria-label={`${row.label}: ${row.value}`}
                data-testid={row.desktopTestId ?? row.testId}
                deleteIcon={
                  row.onCopy ? (
                    <IconButton
                      aria-label={`Copy ${row.label.toLowerCase()}`}
                      data-testid={`${testIdPrefix}-${row.label
                        .toLowerCase()
                        .replace(/\s+/g, "-")}-copy`}
                      onClick={(event) => event.stopPropagation()}
                      size="small"
                      sx={{ p: 0.25 }}
                      type="button"
                    >
                      <ContentCopyIcon fontSize="inherit" />
                    </IconButton>
                  ) : undefined
                }
                label={row.value}
                onDelete={
                  row.onCopy
                    ? () => {
                        row.onCopy();
                      }
                    : undefined
                }
                size="small"
                sx={{ ...chipSx, ...desktopChipVariantSx }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}
    </Box>
  );
};
