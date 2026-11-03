import {
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
  type Theme,
  type SxProps,
} from "@mui/material";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { ReportType, type ReportDto } from "../../../api";
import { formatActivityTimestamp } from "../../Activity/activityFormatting";
import { usePathService } from "../../../contexts";
import { buildEntityHref } from "../../../utils/buildEntityHref";
import { ReportUsageBar } from "./ReportUsageBar";

const USAGE_REPORT_TYPES: ReadonlySet<ReportType> = new Set([
  ReportType.CodingResearch,
  ReportType.Implement,
  ReportType.ChangeWalkthrough,
  ReportType.Review,
  ReportType.FeatureSync,
  ReportType.FeatureSyncHandoff,
  ReportType.FeatureSyncDecision,
]);

// Experiment: Atkinson Hyperlegible Mono (loaded in apps/ui/index.html), falling back to the cross-OS sans-serif stack.
const REPORT_FONT_FAMILY =
  '"Atkinson Hyperlegible Mono", system-ui, -apple-system, "Segoe UI", Arial, Helvetica, sans-serif';

export interface ReportViewerTitleLink {
  entityId: string;
  projectId: string;
  title: string;
}

export interface ReportViewerFrameProps {
  report: ReportDto;
  testId: string;
  children: React.ReactNode;
  /** Whether to render the standard report header (title, type/version chips, created-at timestamp, divider). Default: true */
  renderHeader?: boolean;
  /** Optional compact title-link handoff used when the standard header is suppressed. */
  titleLink?: ReportViewerTitleLink;
  /** Optional custom styling applied to the Paper component, merged with existing background styles */
  sx?: SxProps<Theme>;
  /** Content rendered after and outside the report card. */
  afterFrameContent?: React.ReactNode;
}

export const ReportViewerFrame: React.FC<ReportViewerFrameProps> = ({
  report,
  testId,
  children,
  renderHeader = true,
  titleLink,
  sx,
  afterFrameContent,
}) => {
  const pathService = usePathService();
  const titleHref =
    titleLink?.entityId.trim() &&
    titleLink.projectId.trim() &&
    titleLink.title.trim()
      ? buildEntityHref(pathService, titleLink.projectId, {
          entityType: "report",
          entityId: titleLink.entityId,
        })
      : undefined;
  // Build the sx prop that merges default styles with custom styles
  const paperSx: SxProps<Theme> = (theme) => {
    const defaultStyles = {
      p: 2,
      width: "100%",
      fontFamily: REPORT_FONT_FAMILY,
      "& .MuiTypography-root": { fontFamily: REPORT_FONT_FAMILY },
      "& .MuiTypography-body1, & .MuiTypography-body2": {
        fontSize: "1rem",
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      "& .MuiTypography-caption": {
        fontSize: "0.875rem",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
      },
      "& .MuiTypography-subtitle2": { fontSize: "1rem" },
      "& p:first-of-type": { marginTop: 0 },
      "& p:last-of-type": { marginBottom: 0 },
      backgroundColor:
        theme.palette.mode === "dark"
          ? theme.palette.grey[900]
          : theme.palette.grey[50],
    };

    if (typeof sx === "function") {
      const customStyles = sx(theme);
      return { ...defaultStyles, ...customStyles };
    }

    if (sx) {
      return { ...defaultStyles, ...sx };
    }

    return defaultStyles;
  };

  return (
    <Stack spacing={1.5}>
      <Paper data-testid={testId} sx={paperSx} variant="outlined">
        <Stack spacing={1.5}>
          {renderHeader ? (
            <>
              <Stack
                alignItems={{ xs: "flex-start", sm: "center" }}
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                spacing={1}
              >
                <Typography data-testid={`${testId}-title`} variant="subtitle1">
                  {report.title}
                </Typography>
                <Stack direction="row" spacing={0.75}>
                  <Chip
                    data-testid={`${testId}-type`}
                    label={report.reportType}
                    size="small"
                  />
                  <Chip
                    data-testid={`${testId}-version`}
                    label={`v${report.schemaVersion}`}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
              </Stack>

              <Typography
                color="text.secondary"
                data-testid={`${testId}-created-at`}
                variant="caption"
              >
                Created {formatActivityTimestamp(report.createdAt)}
              </Typography>

              <Divider />
            </>
          ) : titleLink ? (
            <Typography
              data-testid={`${testId}-title-link`}
              variant="subtitle1"
              component={titleHref ? RouterLink : "span"}
              to={titleHref}
              sx={
                titleHref
                  ? {
                      color: "primary.main",
                      textDecoration: "none",
                      "&:hover": { textDecoration: "underline" },
                      "&:focus-visible": {
                        outline: (theme) =>
                          `2px solid ${theme.palette.primary.main}`,
                        outlineOffset: 2,
                      },
                    }
                  : undefined
              }
            >
              {titleLink.title}
            </Typography>
          ) : null}

          {children}

          {USAGE_REPORT_TYPES.has(report.reportType) && (
            <ReportUsageBar usage={report.usage ?? null} />
          )}
        </Stack>
      </Paper>
      {afterFrameContent}
    </Stack>
  );
};
