import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import {
  PlanType,
  TaskSource,
  WorkStatus,
  type PlanConfigurationV1,
} from "@hey-hey/ui-common/api";
import {
  isPlanWorkItem,
  useWorkItemTypeByKey,
  useWorkItemUpdateMethods,
} from "@hey-hey/ui-common/data";
import { EntityActionButton } from "@hey-hey/ui-common/components";
import { TERMS } from "@hey-hey/ui-common/i18n";

interface CreateFeaturePlanButtonProps {
  organizationId: string;
  projectId: string;
  featureId: string;
}

export const CreateFeaturePlanButton = ({
  organizationId,
  projectId,
  featureId,
}: CreateFeaturePlanButtonProps) => {
  const navigate = useNavigate();
  const { createTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId,
  );
  const planType = useWorkItemTypeByKey(organizationId, projectId, "PLAN");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (
      saving ||
      !name.trim() ||
      !outcome.trim() ||
      !organizationId ||
      !projectId ||
      !featureId
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const configuration: PlanConfigurationV1 = {
        schemaVersion: "plan-configuration.v1",
        planType: PlanType.Standard,
        worktreeBranch: null,
      };
      const plan = await createTask({
        name: name.trim(),
        type: "PLAN",
        parentTaskId: featureId,
        status: WorkStatus.Backlog,
        source: TaskSource.User,
        sections: [
          { key: "outcome", content: outcome.trim() },
          { key: "planConfiguration", content: configuration },
        ],
      });
      if (!isPlanWorkItem(plan) || plan.parentTaskId !== featureId)
        throw new Error("The server did not return a Plan for this Feature.");
      setOpen(false);
      navigate("/projects/" + projectId + "/plans/" + plan.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create the Plan.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <EntityActionButton
        verb="create"
        noun={TERMS.Plan}
        entityType="plan"
        workItemIcon={{
          typeKey: "PLAN",
          definition: planType.workItemTypeDefinition,
        }}
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Create Plan</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Plan name"
              required
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Desired outcome"
              required
              multiline
              minRows={3}
              value={outcome}
              disabled={saving}
              onChange={(event) => setOutcome(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !name.trim() || !outcome.trim()}
            onClick={() => {
              void submit();
            }}
          >
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
