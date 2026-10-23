import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemReferenceDto } from "../../../api";
import { RepositoryPlacementStrategyField } from "./RepositoryPlacementStrategyField";
import type { FieldComponentContext, FieldConfig } from "./types";

const { useReferences } = vi.hoisted(() => ({ useReferences: vi.fn() }));
vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferences: useReferences,
}));

const readyReferences = (references: WorkItemReferenceDto[]) => ({
  status: references.length > 0 ? "ready" : "empty",
  isFetching: false,
  references,
});

vi.mock("../../Features/FeaturePicker", () => ({
  FeaturePicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button onClick={() => onChange("11111111-1111-4111-8111-111111111111")}>
      Pick Feature
    </button>
  ),
}));

const config: FieldConfig = {
  field: "repository_placement_strategy",
  description: "Placement",
  type: "repository_placement_strategy",
  payload: { roots: [] },
};
const context = {
  conversationId: "conversation",
  projectId: "project",
  organizationId: "organization",
  interaction: {},
} as FieldComponentContext;

describe("RepositoryPlacementStrategyField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReferences.mockReturnValue(
      readyReferences([
        { id: "existing-feature", name: "Existing", type: "FEATURE" },
      ])
    );
  });

  it("submits the generated add-at-root action", async () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <RepositoryPlacementStrategyField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />
    );
    fireEvent.click(screen.getByText("Add at project root"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ action: "ADD_AT_ROOT" })
    );
    expect(onValidityChange).toHaveBeenLastCalledWith("valid");
  });

  it("requires a selected Feature for the shared existing-parent branch", async () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <RepositoryPlacementStrategyField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: /Add to a parent feature/i })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByText("Add to a parent feature"));
    expect(onValidityChange).toHaveBeenLastCalledWith("invalid");
    fireEvent.click(screen.getByText("Pick Feature"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        action: "ADD_TO_EXISTING",
        parent: {
          targetType: "EXISTING_FEATURE",
          featureId: "11111111-1111-4111-8111-111111111111",
        },
      })
    );
  });

  it("explains each placement choice and includes the root count", () => {
    render(
      <RepositoryPlacementStrategyField
        config={{
          ...config,
          payload: { roots: [{}, {}] },
        }}
        context={context}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByText(
        "2 features will be added to the project's feature tree at the root."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose an existing Feature or create a new one.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Use your Agent Bridge to determine the best fit.")
    ).toBeInTheDocument();
  });

  it("disables feature-dependent placement choices when the project has no Features", async () => {
    useReferences.mockReturnValue(readyReferences([]));
    const onChange = vi.fn();

    render(
      <RepositoryPlacementStrategyField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={onChange}
      />
    );

    const parentChoice = screen.getByRole("radio", {
      name: /Add to a parent feature/i,
    });
    const intelligentChoice = screen.getByRole("radio", {
      name: /Intelligently integrate each root/i,
    });

    await waitFor(() => {
      expect(parentChoice).toBeDisabled();
      expect(intelligentChoice).toBeDisabled();
    });

    expect(
      screen.getByRole("radio", { name: /Add at project root/i })
    ).toBeEnabled();
    expect(
      screen.getByText("Choose an existing Feature or create a new one.")
    ).toBeVisible();
    expect(
      screen.getByText("Use your Agent Bridge to determine the best fit.")
    ).toBeVisible();

    fireEvent.click(parentChoice);
    fireEvent.click(intelligentChoice);

    expect(screen.queryByText("Pick Feature")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("radio", { name: /Add at project root/i })
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ action: "ADD_AT_ROOT" })
    );
  });

  it("treats a failed hierarchy read as an error rather than an empty project", () => {
    useReferences.mockReturnValue({
      status: "error",
      isFetching: false,
      references: [],
      error: new Error("references failed"),
    });

    render(
      <RepositoryPlacementStrategyField
        config={config}
        context={context}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByRole("radio", { name: /Add to a parent feature/i })
    ).toBeEnabled();
  });

  it("keeps feature-dependent placement choices available when Features exist", async () => {
    const onChange = vi.fn();

    render(
      <RepositoryPlacementStrategyField
        config={config}
        context={context}
        isSubmitted={false}
        onChange={onChange}
      />
    );

    const parentChoice = screen.getByRole("radio", {
      name: /Add to a parent feature/i,
    });
    const intelligentChoice = screen.getByRole("radio", {
      name: /Intelligently integrate each root/i,
    });

    await waitFor(() => {
      expect(parentChoice).toBeEnabled();
      expect(intelligentChoice).toBeEnabled();
    });

    fireEvent.click(intelligentChoice);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        action: "INTELLIGENTLY_INTEGRATE",
      })
    );
  });
});
