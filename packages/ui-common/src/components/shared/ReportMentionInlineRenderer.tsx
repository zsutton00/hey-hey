import { Stack } from "@mui/material";
import React, { useContext } from "react";
import { ReportViewer } from "../Reports/ReportViewer";
import { getReportPresentation } from "../Reports/reportConfig";
import { useReport } from "../../data/hooks/useReport";
import { useProjectContext } from "../../contexts";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import {
  MentionBadgeInner,
  type MentionMode,
} from "../SmarterTextAreaCard/MentionBadge";
import type { EntityMention } from "../SmarterTextAreaCard/types";

export const REPORT_MENTION_ENTITY_TYPE = "report" as const;

interface ReportMentionInlineRendererProps {
  mention: EntityMention;
  mode?: MentionMode;
}

const isReportMention = (mention: EntityMention): boolean =>
  mention.entityType === REPORT_MENTION_ENTITY_TYPE;

export const ReportMentionInlineRenderer: React.FC<
  ReportMentionInlineRendererProps
> = ({ mention, mode }) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const context = editorContext ?? projectContext;
  const canLoadReport = isReportMention(mention) && !!context;
  const reportQuery = useReport(
    canLoadReport ? context?.organizationId : undefined,
    canLoadReport ? mention.entityId : undefined,
    { enabled: canLoadReport }
  );

  if (!canLoadReport || reportQuery.isLoading || reportQuery.isFetching) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  if (reportQuery.error || !reportQuery.data) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  if (getReportPresentation(reportQuery.data.reportType) === "interactive") {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  return (
    <Stack
      data-testid="report-inline-mention"
      data-report-id={mention.entityId}
      spacing={1}
      sx={{ my: 1 }}
    >
      <ReportViewer
        report={reportQuery.data}
        renderHeader={false}
        titleLink={{
          entityId: reportQuery.data.id,
          projectId: context.projectId,
          title: reportQuery.data.title,
        }}
      />
    </Stack>
  );
};
