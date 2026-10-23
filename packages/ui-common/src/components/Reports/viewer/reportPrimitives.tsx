import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type {
  EntityType,
  FeatureSyncReportSourceType,
  ReportRelatedEntityType,
} from "../../../api";
import {
  MentionBadgeInner,
  type MentionMode,
} from "../../SmarterTextAreaCard/MentionBadge";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type { EntityMention } from "../../SmarterTextAreaCard/types";

type ReportMentionEntityType =
  | EntityType
  | ReportRelatedEntityType
  | FeatureSyncReportSourceType
  | "contract"
  | "workflowStep";

export interface ReportPanelProps {
  title: string;
  testId: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children?: React.ReactNode;
  reportId?: string;
}

export const ReportPanel: React.FC<ReportPanelProps> = ({
  title,
  testId,
  isEmpty,
  emptyMessage,
  children,
  reportId,
}) => (
  <Stack data-report-id={reportId} data-testid={testId} spacing={0.75}>
    <Typography variant="subtitle2">{title}</Typography>
    {isEmpty ? (
      <Typography
        color="text.secondary"
        data-report-id={reportId}
        data-testid={`${testId}-empty`}
        variant="body2"
      >
        {emptyMessage}
      </Typography>
    ) : (
      children
    )}
  </Stack>
);

export interface ReportDisclosureProps {
  title: string;
  testId: string;
  children: React.ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
  reportId?: string;
}

export const ReportDisclosure: React.FC<ReportDisclosureProps> = ({
  title,
  testId,
  children,
  onExpandedChange,
  reportId,
}) => (
  <Accordion
    data-report-id={reportId}
    data-testid={testId}
    disableGutters
    onChange={(_, expanded) => onExpandedChange?.(expanded)}
    slotProps={{ transition: { unmountOnExit: true } }}
    sx={{
      "&:before": { display: "none" },
      borderRadius: 1,
      overflow: "hidden",
    }}
    variant="outlined"
  >
    <AccordionSummary
      data-testid={`${testId}-toggle`}
      expandIcon={<ExpandMoreIcon />}
    >
      <Typography variant="subtitle2">{title}</Typography>
    </AccordionSummary>
    <AccordionDetails data-testid={`${testId}-content`}>
      {children}
    </AccordionDetails>
  </Accordion>
);

export interface ReportItemCardProps {
  title: React.ReactNode;
  testId: string;
  secondaries?: React.ReactNode[];
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  reportId?: string;
}

export const ReportItemCard: React.FC<ReportItemCardProps> = ({
  title,
  testId,
  secondaries,
  trailing,
  children,
  reportId,
}) => (
  <Paper
    data-report-id={reportId}
    data-testid={testId}
    sx={{ p: 1.5 }}
    variant="outlined"
  >
    <Stack spacing={1}>
      <Stack
        alignItems={{ xs: "flex-start", sm: "center" }}
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        spacing={1}
      >
        {typeof title === "string" ? (
          <Typography variant="body2">{title}</Typography>
        ) : (
          title
        )}
        {trailing}
      </Stack>
      {children}
      {secondaries && secondaries.length > 0
        ? secondaries.map((secondary, index) => (
            <Typography
              color="text.secondary"
              key={`secondary-${index}`}
              variant="caption"
            >
              {secondary}
            </Typography>
          ))
        : null}
    </Stack>
  </Paper>
);

export interface ReportLabeledTextProps {
  label: string;
  value: React.ReactNode;
  testId?: string;
  renderMentions?: boolean;
}

export const ReportLabeledText: React.FC<ReportLabeledTextProps> = ({
  label,
  value,
  testId,
  renderMentions,
}) => (
  <Stack data-testid={testId} spacing={0.25}>
    <Typography color="text.secondary" variant="caption">
      {label}
    </Typography>
    {typeof value === "string" ? (
      <Typography variant="body2">
        {renderMentions ? renderInlineMentions(value, "minimal") : value}
      </Typography>
    ) : (
      value
    )}
  </Stack>
);

export interface ReportEntityMentionProps {
  entityType: ReportMentionEntityType;
  entityId: string;
  entityName?: string;
  mode?: MentionMode;
}

export const ReportEntityMention: React.FC<ReportEntityMentionProps> = ({
  entityType,
  entityId,
  entityName,
  mode = "minimal",
}) => {
  const mention: EntityMention = {
    entityType,
    entityId,
    entityName: entityName ?? entityId,
  };

  return <MentionBadgeInner mention={mention} mode={mode} />;
};
