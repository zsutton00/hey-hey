import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSkillsCatalogState } from "../../AgentSession/runtime/hooks/useAgentSkillsCatalog";
import { SkillPickerDialog } from "../slashCommands/SkillPickerDialog";

const mocks = vi.hoisted(() => ({
  state: { status: "loading" } as AgentSkillsCatalogState,
  reload: vi.fn(),
}));

vi.mock("../../AgentSession/runtime/hooks/useAgentSkillsCatalog", () => ({
  useAgentSkillsCatalog: () => ({ state: mocks.state, reload: mocks.reload }),
  skillSelectionFromCatalogEntry: (entry: {
    provider: "codex";
    name: string;
    catalogScope: "repo";
  }) => ({
    provider: entry.provider,
    name: entry.name,
    catalogScope: entry.catalogScope,
  }),
}));

const context = {
  organizationId: "org-1",
  projectId: "project-1",
  agentSessionId: "session-1",
  runId: "run-1",
  machineId: "machine-1",
  provider: "codex" as const,
  selectedSkill: null,
  onSkillSelected: vi.fn(),
};

const entry = {
  provider: "codex" as const,
  name: "release-check",
  catalogScope: "repo" as const,
  description: "Checks the release state.",
  shortDescription: "Review a release.",
  enabled: true,
  interface: {
    displayName: "Release Check",
    shortDescription: "Review a release.",
  },
};

beforeEach(() => {
  mocks.state = { status: "loading" };
  mocks.reload.mockReset();
});

describe("SkillPickerDialog", () => {
  it.each([
    ["loading", { status: "loading" }],
    ["empty", { status: "empty", catalog: { runId: "run-1", provider: "codex", skills: [], errors: [] } }],
    [
      "discovery error",
      { status: "discovery-error", errors: [{ provider: "codex", message: "Unreadable Skill directory." }] },
    ],
    [
      "bridge unavailable",
      { status: "bridge-unavailable", message: "The attached machine is unavailable." },
    ],
  ] as const)("renders the explicit %s state", (_name, state) => {
    mocks.state = state;
    render(
      <SkillPickerDialog
        open
        context={context}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId(`skill-picker-${state.status === "discovery-error" ? "error" : state.status === "bridge-unavailable" ? "bridge-unavailable" : state.status}`)).toBeInTheDocument();
  });

  it("shows provider metadata and emits a pathless selection", () => {
    const onSelect = vi.fn();
    mocks.state = {
      status: "ready",
      catalog: {
        runId: "run-1",
        provider: "codex",
        skills: [entry],
        errors: [],
      },
    };

    render(
      <SkillPickerDialog
        open
        context={context}
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByText("Release Check")).toBeInTheDocument();
    expect(screen.getByText(/codex · repo/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skill-picker-option"));

    expect(onSelect).toHaveBeenCalledWith({
      provider: "codex",
      name: "release-check",
      catalogScope: "repo",
    });
    expect(JSON.stringify(onSelect.mock.calls[0])).not.toContain("path");
  });

  it("shows partial discovery warnings while keeping usable Skills selectable", () => {
    mocks.state = {
      status: "ready",
      catalog: {
        runId: "run-1",
        provider: "codex",
        skills: [entry],
        errors: [{ provider: "codex", message: "One location failed." }],
      },
    };

    render(
      <SkillPickerDialog
        open
        context={context}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId("skill-picker-discovery-warning")).toBeInTheDocument();
    expect(screen.getByTestId("skill-picker-option")).toBeEnabled();
  });
});
