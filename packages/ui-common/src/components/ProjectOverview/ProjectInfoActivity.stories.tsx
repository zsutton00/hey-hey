import { useState } from "react";
import { Button, Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../api";
import {
  ProjectInfoActivityView,
  type ProjectInfoActivityViewProps,
} from "./ProjectOverview";

const proposal: ProposalResponseDto = {
  id: "fixture-proposal",
  organizationId: "fixture-org",
  projectId: "fixture-project",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityId: "fixture-target",
  targetEntityType: TargetEntityType.Task,
  title: "Shared loading presentation",
  updates: { type: "FEATURE" },
  requestorId: "fixture-user",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-09-28T12:00:00Z",
  updatedAt: "2026-09-28T12:00:00Z",
};
type Stage = "pending" | "results" | "empty" | "refresh" | "failure";
const Fixture = () => {
  const [stage, setStage] = useState<Stage>("pending");
  const [identity, setIdentity] = useState(0);
  const [activeTab, setActiveTab] = useState<"created" | "updated">("created");
  const rows = stage === "empty" ? [] : [{ proposal, iconType: "task" }];
  const page = { total: rows.length, page: 1, totalPages: 1 };
  const query = {
    ...page,
    data: [proposal],
    requestedPage: 1,
    isLoading: false,
    isFetching: stage === "refresh",
    isReady: true,
    error: null,
    refetch: async () => [],
    goToPage: () => undefined,
  };
  const activity: ProjectInfoActivityViewProps["activity"] = {
    identity: String(identity),
    pending: stage === "pending" || stage === "refresh",
    snapshot:
      stage === "pending"
        ? undefined
        : {
            created: rows,
            updated: rows,
            createdPage: page,
            updatedPage: page,
          },
    activityError: stage === "failure" ? new Error("Refresh failed") : null,
    retryActivity: () => setStage("refresh"),
    createdQuery: query,
    updatedQuery: query,
  };
  return (
    <Stack spacing={2} sx={{ width: 720 }}>
      <Stack direction="row" spacing={1}>
        {(["pending", "results", "empty", "refresh", "failure"] as const).map(
          (value) => (
            <Button key={value} onClick={() => setStage(value)}>
              {value}
            </Button>
          )
        )}
        <Button
          onClick={() => {
            setIdentity((value) => value + 1);
            setStage("pending");
          }}
        >
          Replace selection
        </Button>
      </Stack>
      <ProjectInfoActivityView
        activity={activity}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpen={() => undefined}
      />
    </Stack>
  );
};
const meta: Meta<typeof Fixture> = {
  title: "Components/ProjectOverview/Activity continuity",
  component: Fixture,
};
export default meta;
export const Lifecycle: StoryObj<typeof Fixture> = {};
