import { Stack, Typography } from "@mui/material";
import React from "react";
import { ReportViewer } from "../Reports";
import type { CorrelatedActivityDisplayRecord } from "../../data/hooks/useCorrelatedActivity";
import { ActivityHistoryRow } from "./ActivityHistoryRow";
import { ActivityGraphLayout } from "./ActivityGraphLayout";
import { mapActivityRecordToGraphData } from "./mapActivityRecordToGraphData";

export interface ActivityDetailLayoutProps {
  activity: CorrelatedActivityDisplayRecord;
  organizationId: string;
  projectId: string;
}

export const ActivityDetailLayout: React.FC<ActivityDetailLayoutProps> = ({
  activity,
  projectId,
}) => {
  const reports = activity.reports;
  const graph = mapActivityRecordToGraphData(activity);

  return (
    <Stack data-testid="activity-detail-layout" spacing={2}>
      <ActivityHistoryRow activity={activity} projectId={projectId} />
      <ActivityGraphLayout
        {...graph}
        projectId={projectId}
        reports={[]}
        testIdPrefix="activity-detail-graph"
      />

      {reports.length > 0 ? (
        <Stack data-testid="activity-detail-reports" spacing={2}>
          <Typography variant="h6">Reports</Typography>
          {reports.map((report) => (
            <ReportViewer
              key={report.id}
              report={report}
              testIdPrefix="activity-detail-report"
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
};
