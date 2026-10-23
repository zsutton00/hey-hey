import { Box, Typography } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { ServiceDto } from "../../api";
import { Priority, WorkStatus } from "../../api";
import { AuthProvider } from "../../contexts/AuthContext";
import { StatusActionCompact } from "./StatusActionCompact";

interface HarnessProps {
  initialStatus: WorkStatus;
  initialPriority: Priority;
  initialDueDate: string | null;
  initialAssigneeId: string | null;
  initialServiceIds?: string[];
  withServices?: boolean;
}

const StatusActionCompactHarness: React.FC<HarnessProps> = ({
  initialStatus,
  initialPriority,
  initialDueDate,
  initialAssigneeId,
  initialServiceIds = [],
  withServices = false,
}) => {
  const [status, setStatus] = useState<WorkStatus>(initialStatus);
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [dueDate, setDueDate] = useState<string | null>(initialDueDate);
  const [assigneeId, setAssigneeId] = useState<string | null>(
    initialAssigneeId
  );
  const [serviceIds, setServiceIds] = useState<string[]>(initialServiceIds);

  return (
    <AuthProvider>
      <Box
        sx={{ p: 2, width: 375, border: "1px dashed", borderColor: "divider" }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Narrow viewport (375px) — icon-row metadata controls
        </Typography>
        <StatusActionCompact
          status={status}
          priority={priority}
          dueDate={dueDate}
          assigneeId={assigneeId}
          organizationId="storybook-org"
          projectId="storybook-project"
          onStatusChange={setStatus}
          onPriorityChange={setPriority}
          onDueDateChange={setDueDate}
          onAssigneeChange={setAssigneeId}
          taskServices={
            withServices
              ? {
                  serviceIds,
                  onChange: (next: string[], _services: ServiceDto[]) =>
                    setServiceIds(next),
                }
              : undefined
          }
        />
        <Box sx={{ mt: 2, fontFamily: "monospace", fontSize: 12 }}>
          <div>status: {status}</div>
          <div>priority: {priority}</div>
          <div>dueDate: {dueDate ?? "(none)"}</div>
          <div>assigneeId: {assigneeId ?? "(unassigned)"}</div>
          {withServices && (
            <div>
              services:{" "}
              {serviceIds.length === 0 ? "(none)" : serviceIds.join(", ")}
            </div>
          )}
        </Box>
      </Box>
    </AuthProvider>
  );
};

const meta: Meta<typeof StatusActionCompactHarness> = {
  title: "Components/WorkItem/StatusActionCompact",
  component: StatusActionCompactHarness,
};

export default meta;

type Story = StoryObj<typeof StatusActionCompactHarness>;

export const NarrowViewport: Story = {
  args: {
    initialStatus: WorkStatus.Backlog,
    initialPriority: "MEDIUM",
    initialDueDate: null,
    initialAssigneeId: null,
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const ActiveWithDueDate: Story = {
  args: {
    initialStatus: WorkStatus.Active,
    initialPriority: "HIGH",
    initialDueDate: "2026-06-01",
    initialAssigneeId: null,
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const VerifyingLowPriority: Story = {
  args: {
    initialStatus: WorkStatus.Verifying,
    initialPriority: "LOW",
    initialDueDate: null,
    initialAssigneeId: null,
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const WithServices: Story = {
  args: {
    initialStatus: WorkStatus.Backlog,
    initialPriority: "MEDIUM",
    initialDueDate: null,
    initialAssigneeId: null,
    initialServiceIds: [],
    withServices: true,
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
