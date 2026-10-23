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
import type { ReportDto } from "../../../api";
import { formatActivityTimestamp } from "../../Activity/activityFormatting";
import { usePathService } from "../../../contexts";
import { buildEntityHref } from "../../../utils/buildEntityHref";

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
}

export const ReportViewerFrame: React.FC<ReportViewerFrameProps> = ({
  report,
  testId,
  children,
  renderHeader = true,
  titleLink,
  sx,
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
      </Stack>
    </Paper>
  );
};
