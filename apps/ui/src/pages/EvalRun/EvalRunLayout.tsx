import { Alert, Box, CircularProgress } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";

import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import { useWorkItem } from "@hey-hey/ui-common/data";

import { DetailPageContainer } from "../../components/Layout";
import { TaskBreadcrumbs } from "../../components/TaskBreadcrumbs";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";

export interface EvalRunLayoutProps {
  organizationId: string;
  projectId: string;
  evalId: string;
  /** Current page label after the Eval in the breadcrumbs. */
  crumbLabel: string;
  testId: string;
  children: (evalTask: TaskResponseDto) => React.ReactNode;
}

/** Loads the Eval and frames a run page under it in the breadcrumbs. */
export const EvalRunLayout: React.FC<EvalRunLayoutProps> = ({
  organizationId,
  projectId,
  evalId,
  crumbLabel,
  testId,
  children,
}) => {
  const { t } = useTranslation();
  const { workItem, isLoading, error } = useWorkItem(
    organizationId,
    "task",
    evalId,
    { projectId, enabled: !!organizationId && !!evalId },
  );
  const evalTask = workItem as TaskResponseDto | null;
  const { ancestors } = useFeatureAncestors({
    organizationId,
    projectId,
    task: evalTask ?? undefined,
  });

  if (error) {
    return (
      <Alert
        severity="error"
        sx={{ m: 3 }}
        data-testid={`${testId}-eval-error`}
      >
        {t("eval.run.evalLoadError")}
      </Alert>
    );
  }
  if (isLoading || !evalTask) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <TaskBreadcrumbs
        projectId={projectId}
        task={evalTask}
        featureAncestors={ancestors}
        childLabel={crumbLabel}
      />
      <DetailPageContainer>
        <Box data-testid={testId} sx={{ p: 3 }}>
          {children(evalTask)}
        </Box>
      </DetailPageContainer>
    </>
  );
};
