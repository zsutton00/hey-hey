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
import { Fragment, useId, useState } from "react";
import type { SxProps, Theme } from "@mui/material/styles";

export interface MetadataDisclosureValueRow {
  label: string;
  value: string;
  testId?: string;
  mobileTestId?: string;
  desktopTestId?: string;
  /** Text shown on the desktop chip when it should differ from `value`. */
  desktopText?: string;
  /** Marks a value that is absent; the desktop chip gets a dashed border. */
  dashed?: boolean;
  /** Test id for the desktop copy button; defaults to one derived from the label. */
  copyTestId?: string;
  /** Mobile disclosure shows a subheading when this changes between rows. */
  group?: string;
  /** Short status pill shown after the value. */
  badge?: string;
  /** Secondary line about the value. */
  note?: string;
  onCopy?: never;
}

export interface MetadataDisclosureCopyRow {
  label: string;
  value: string;
  testId?: string;
  mobileTestId?: string;
  desktopTestId?: string;
  /** Text shown on the desktop chip when it should differ from `value`. */
  desktopText?: string;
  /** Marks a value that is absent; the desktop chip gets a dashed border. */
  dashed?: boolean;
  /** Test id for the desktop copy button; defaults to one derived from the label. */
  copyTestId?: string;
  /** Mobile disclosure shows a subheading when this changes between rows. */
  group?: string;
  /** Short status pill shown after the value. */
  badge?: string;
  /** Secondary line about the value. */
  note?: string;
  onCopy: () => void;
}

export type MetadataDisclosureRow =
  MetadataDisclosureValueRow | MetadataDisclosureCopyRow;

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

const truncatedSx = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
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

// Takes only the width the chips leave free; the chip's tooltip keeps the text.
const noteSx = {
  ...truncatedSx,
  flex: "1 1 0",
  maxWidth: "max-content",
} as const;

const badgeSx = {
  display: "inline-block",
  flexShrink: 0,
  px: 0.75,
  border: 1,
  borderColor: "primary.main",
  borderRadius: 4,
  color: "text.primary",
  typography: "caption",
  lineHeight: 1.4,
} as const;

const hasDisplayValue = (value: string): boolean => value.trim().length > 0;

const describeRow = (parts: readonly (string | undefined)[]): string =>
  parts.filter(Boolean).join(" · ");

const desktopChipLabel = (row: MetadataDisclosureRow) => {
  const text = row.desktopText ?? row.value;
  if (row.badge === undefined) {
    return text;
  }

  // The badge never shrinks, so it stays readable when the row is crowded.
  return (
    <Box
      component="span"
      sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
    >
      <Box component="span" sx={truncatedSx}>
        {text}
      </Box>
      <Box component="span" sx={badgeSx}>
        {row.badge}
      </Box>
    </Box>
  );
};

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
              title={
                mobileDetailsOpen ? "Hide more details" : "Show more details"
              }
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
                  <Fragment key={`${row.label}-${index}`}>
                    {row.group !== undefined &&
                    row.group !== displayRows[index - 1]?.group ? (
                      <Typography
                        component="div"
                        variant="subtitle2"
                        sx={{ pt: 0.5 }}
                      >
                        {row.group}
                      </Typography>
                    ) : null}
                    <Box
                      component="div"
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
                        {row.badge !== undefined ? (
                          <Box component="span" sx={{ display: "block" }}>
                            <Box component="span" sx={badgeSx}>
                              {row.badge}
                            </Box>
                          </Box>
                        ) : null}
                        {row.note !== undefined ? (
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            {row.note}
                          </Typography>
                        ) : null}
                      </Typography>
                    </Box>
                  </Fragment>
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
            <Fragment key={`${row.label}-${index}`}>
              <Tooltip
                title={describeRow([row.label, row.badge, row.note])}
                arrow
              >
                <Chip
                  aria-label={describeRow([
                    `${row.label}: ${row.value}`,
                    row.badge,
                    row.note,
                  ])}
                  data-testid={row.desktopTestId ?? row.testId}
                  variant={row.dashed ? "outlined" : "filled"}
                  deleteIcon={
                    row.onCopy ? (
                      <IconButton
                        aria-label={`Copy ${row.label.toLowerCase()}`}
                        data-testid={
                          row.copyTestId ??
                          `${testIdPrefix}-${row.label
                            .toLowerCase()
                            .replace(/\s+/g, "-")}-copy`
                        }
                        onClick={(event) => event.stopPropagation()}
                        size="small"
                        sx={{ p: 0.25 }}
                        type="button"
                      >
                        <ContentCopyIcon fontSize="inherit" />
                      </IconButton>
                    ) : undefined
                  }
                  label={desktopChipLabel(row)}
                  onDelete={
                    row.onCopy
                      ? () => {
                          row.onCopy();
                        }
                      : undefined
                  }
                  size="small"
                  sx={{
                    ...chipSx,
                    ...desktopChipVariantSx,
                    ...(row.dashed ? { borderStyle: "dashed" } : {}),
                  }}
                />
              </Tooltip>
              {row.note !== undefined ? (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={noteSx}
                >
                  {row.note}
                </Typography>
              ) : null}
            </Fragment>
          ))}
        </Stack>
      )}
    </Box>
  );
};
