import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationSetup } from "../PlanGenerationSetup";

const prepare = vi.hoisted(() => vi.fn());
const seed = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({ designDoc: () => "/document" }),
}));
vi.mock("../usePlanFromDesignDocSeed", () => ({
  usePlanFromDesignDocSeed: seed,
}));
vi.mock("../runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    selectedMachine: { machineId: "machine" },
    machines: [],
    isReady: true,
    mode: "one",
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../RuntimeModelSelector", () => ({
  RuntimeModelSelector: () => <div>Model selection</div>,
}));
vi.mock("../../shared/DesignDocReadView", () => ({
  DesignDocReadView: ({
    title,
    sections,
  }: {
    title: string;
    sections: { materializedMarkdown: string }[];
  }) => (
    <article>
      {title}
      {sections.map((section) => section.materializedMarkdown).join("\n")}
    </article>
  ),
}));
vi.mock("../surfaceSelectionMemory", () => ({
  readSurfaceSelection: () => null,
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "chosen-model",
    reasoningEffort: null,
    fastMode: false,
  }),
  writeSurfaceSelection: vi.fn(),
}));
const draftProps = {
  planName: "Existing Plan",
  configuration: {
    schemaVersion: "plan-configuration.v1",
    planType: "STANDARD",
    worktreeBranch: null,
  } as const,
  onPreparingChange: vi.fn(),
};
vi.mock("../../../clients/serviceClients", () => ({
  plansClient: { prepareWorkItemPlanGeneration: prepare },
}));

describe("PlanGenerationSetup", () => {
  beforeEach(() => {
    prepare.mockReset();
    seed.mockReturnValue({
      seed: {
        title: "Original design doc",
        sections: [
          {
            key: "content",
            materializedMarkdown: "Preserved design decisions",
          },
        ],
      },
      designDocId: "doc",
      isLoading: false,
      error: null,
    });
  });

  it("prepares the existing Plan only on click and refreshes the conversation", async () => {
    let resolve!: (value: unknown) => void;
    prepare.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const onPrepared = vi.fn();
    render(
      <PlanGenerationSetup
        {...draftProps}
        organizationId="org"
        projectId="project"
        planId="plan"
        onPrepared={onPrepared}
      />
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.getByRole("article")).toHaveTextContent(
      "Preserved design decisions"
    );
    expect(screen.queryByText("Set up generation")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Start generating" })
    );
    expect(prepare).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org",
      projectId: "project",
      taskId: "plan",
    });
    expect(
      screen.getByRole("button", { name: "Start generating" })
    ).toBeDisabled();
    resolve({
      data: { id: "new-session", conversationId: "new-conversation" },
    });
    await waitFor(() => expect(onPrepared).toHaveBeenCalledOnce());
    expect(onPrepared).toHaveBeenCalledWith({
      conversationId: "new-conversation",
      agentSessionId: "new-session",
      settings: expect.objectContaining({
        machineId: "machine",
        worktreeBranch: null,
        selection: expect.objectContaining({ model: "chosen-model" }),
      }),
    });
  });

  it("shows setup failures and allows a retry", async () => {
    prepare.mockRejectedValueOnce(new Error("Link a design doc first"));
    prepare.mockResolvedValueOnce({
      data: { conversationId: "new-conversation" },
    });
    const onPrepared = vi.fn();
    render(
      <PlanGenerationSetup
        {...draftProps}
        organizationId="org"
        projectId="project"
        planId="plan"
        onPrepared={onPrepared}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Start generating" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Link a design doc first"
    );
    expect(onPrepared).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Start generating" })
    );
    await waitFor(() => expect(onPrepared).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports an actually missing document instead of offering setup", () => {
    seed.mockReturnValue({ seed: null, isLoading: false, error: null });
    render(
      <PlanGenerationSetup
        {...draftProps}
        organizationId="org"
        projectId="project"
        planId="plan"
        onPrepared={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No design doc is linked"
    );
    expect(
      screen.queryByRole("button", { name: "Start generating" })
    ).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps model controls hidden until the design doc has loaded", () => {
    seed.mockReturnValue({ seed: null, isLoading: true, error: null });
    render(
      <PlanGenerationSetup
        {...draftProps}
        organizationId="org"
        projectId="project"
        planId="plan"
        onPrepared={vi.fn()}
      />
    );
    expect(
      screen.getByRole("progressbar", { name: "Loading Plan design doc" })
    ).toBeTruthy();
    expect(screen.queryByText("Model selection")).toBeNull();
  });

  it("shows the underlying load failure and allows retrying it", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    seed.mockReturnValue({
      seed: null,
      isLoading: false,
      error: new Error("Linked document lookup failed: 403 Forbidden"),
      retry,
    });
    render(
      <PlanGenerationSetup
        {...draftProps}
        organizationId="org"
        projectId="project"
        planId="plan"
        onPrepared={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("403 Forbidden");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
});
