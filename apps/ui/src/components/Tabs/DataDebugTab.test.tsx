import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { DataDebugTab } from "./DataDebugTab";

const { replayPanel, getDebugEmbeddingsEntity, capabilities } = vi.hoisted(
  () => ({
    replayPanel: vi.fn(),
    getDebugEmbeddingsEntity: vi.fn(),
    capabilities: { viewProjectEmbeddings: false },
  }),
);

vi.mock("@hey-hey/ui-common/clients", () => ({
  entityContextClient: {
    getEntityContext: vi.fn().mockResolvedValue({ data: {} }),
  },
  unifiedApiClient: {
    getDebugEmbeddingsEntity,
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useProjectCapabilities: () => capabilities,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  OutboxEvents: () => <div>outbox events</div>,
}));

vi.mock("./EntityRelationshipsTab", () => ({
  EntityRelationshipsTab: () => <div>relationships</div>,
}));

vi.mock("./DebugEventReplayPanel", () => ({
  DebugEventReplayPanel: (props: unknown) => {
    replayPanel(props);
    return <div>event replay controls</div>;
  },
}));

describe("DataDebugTab", () => {
  it("keeps replay inside Data Debug and passes the displayed entity scope", () => {
    render(
      <DataDebugTab
        entityId="workflow-step-1"
        entityType="workflow_step"
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));

    expect(screen.getByText("event replay controls")).toBeInTheDocument();
    expect(replayPanel).toHaveBeenCalledWith({
      entityId: "workflow-step-1",
      entityType: "workflow_step",
      projectId: "project-1",
    });
  });

  it("hides Embeddings from callers who are not project Owners", () => {
    capabilities.viewProjectEmbeddings = false;
    render(
      <DataDebugTab
        entityId="task-1"
        entityType="task"
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Embeddings" }),
    ).not.toBeInTheDocument();
  });

  it("asks for the project's embeddings when an Owner opens Embeddings", async () => {
    capabilities.viewProjectEmbeddings = true;
    getDebugEmbeddingsEntity.mockResolvedValue({ data: {} });
    render(
      <DataDebugTab
        entityId="task-1"
        entityType="task"
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Embeddings" }));

    await waitFor(() =>
      expect(getDebugEmbeddingsEntity).toHaveBeenCalledWith({
        type: "task",
        id: "task-1",
        projectId: "project-1",
      }),
    );
  });
});
