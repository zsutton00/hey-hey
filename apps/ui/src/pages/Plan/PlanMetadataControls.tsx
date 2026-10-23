import { useState } from "react";
import { Alert, Stack } from "@mui/material";
import { WorkItemMetadata } from "@hey-hey/ui-common/components";
import {
  useCanonicalPlanMutations,
  type PlanWorkItem,
} from "@hey-hey/ui-common/data";
import type { WorkStatus } from "@hey-hey/ui-common/api";

export const PlanMetadataControls = ({
  plan,
  readOnly = false,
}: {
  plan: PlanWorkItem;
  readOnly?: boolean;
}) => {
  const { updatePlan } = useCanonicalPlanMutations(
    plan.organizationId,
    plan.projectId
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const changeStatus = async (status: WorkStatus) => {
    if (saving || readOnly) return;
    setSaving(true);
    setError(null);
    setPending(false);
    try {
      const result = await updatePlan(plan.id, { status });
      setPending(result.status === "pending");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update Plan status."
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Stack spacing={1}>
      {error && <Alert severity="error">{error}</Alert>}
      {pending && (
        <Alert severity="info">
          The status change is awaiting proposal approval.
        </Alert>
      )}
      <WorkItemMetadata
        organizationId={plan.organizationId}
        projectId={plan.projectId}
        currentTaskId={plan.id}
        taskType={plan.type}
        disabled={saving}
        fields={{
          status: readOnly
            ? { mode: "readOnly", value: plan.status }
            : {
                mode: "editable",
                value: plan.status,
                onChange: (status) => {
                  void changeStatus(status);
                },
              },
        }}
      />
    </Stack>
  );
};
