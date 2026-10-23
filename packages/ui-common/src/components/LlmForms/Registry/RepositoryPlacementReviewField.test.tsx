import React from "react";
import { Provider } from "jotai";
import { referencesResponse } from "../../Features/__tests__/featureTreeReferences";
import {
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureTag,
  TaskSource,
  WorkStatus,
  type RepositoryPlacementReviewPayload,
  type TaskResponseDto,
} from "../../../api";
import type { FeaturePickerProps } from "../../Features/FeaturePicker";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { RepositoryPlacementReviewField } from "./RepositoryPlacementReviewField";
import {
  createRepositoryPlacementReviewValue,
  type FieldComponentContext,
  type FieldConfig,
} from "./types";

const render: typeof testingRender = (ui, options) =>
  testingRender(ui, { wrapper: Provider, ...options });

const deepFeature: TaskResponseDto = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Operations",
  type: "FEATURE",
  organizationId: "organization",
  projectId: "project",
  status: WorkStatus.Active,
  source: TaskSource.User,
  tag: FeatureTag.Infra,
  parentTaskId: "22222222-2222-4222-8222-222222222222",
};

const isolatedParent: TaskResponseDto = {
  ...deepFeature,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Customer Experience",
  tag: FeatureTag.Product,
  parentTaskId: undefined,
};

const isolatedFeature: TaskResponseDto = {
  ...deepFeature,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Support",
  tag: FeatureTag.Product,
  parentTaskId: isolatedParent.id,
};

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: vi.fn(),
    getTasks: vi.fn(),
    listWorkItemReferences: vi.fn(),
  },
}));

vi.mock("../../Features/FeaturePicker", () => ({
  FeaturePicker: ({ label, onChange, disabled, value }: FeaturePickerProps) => (
    <div data-testid="feature-picker" data-value={value ?? "project-root"}>
      <button
        disabled={disabled}
        onClick={() => onChange(deepFeature.id, deepFeature)}
      >
        {label} choose Operations
      </button>
      <button onClick={() => onChange(isolatedFeature.id, isolatedFeature)}>
        {label} choose Support
      </button>
    </div>
  ),
}));

const payload: RepositoryPlacementReviewPayload = {
  roots: [
    {
      root: {
        rootKey: "insights-root",
        name: "Insights",
        description: "Reporting capability",
        tag: FeatureTag.Product,
        children: [
          {
            childKey: "dashboard-child",
            name: "Dashboard",
            description: "Interactive dashboard",
            tag: FeatureTag.Frontend,
          },
          {
            childKey: "metrics-child",
            name: "Metrics API",
            description: "Metrics backend",
            tag: FeatureTag.Backend,
          },
        ],
      },
      selectedParent: {
        kind: "EXISTING_FEATURE",
        featureId: "11111111-1111-4111-8111-111111111111",
      },
      selectedParentLineage: [
        {
          featureId: "00000000-0000-4000-8000-000000000001",
          name: "Product",
          tag: FeatureTag.Product,
        },
        {
          featureId: "11111111-1111-4111-8111-111111111111",
          name: "Analytics",
          tag: FeatureTag.Product,
          parentFeatureId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    },
    {
      root: {
        rootKey: "alerts-root",
        name: "Alerts",
        description: "Operational alerts",
        tag: FeatureTag.Product,
        children: [
          {
            childKey: "rules-child",
            name: "Alert Rules",
            description: "Configurable rules",
            tag: FeatureTag.Backend,
          },
        ],
      },
      selectedParent: {
        kind: "EXISTING_FEATURE",
        featureId: deepFeature.id,
      },
      selectedParentLineage: [
        {
          featureId: "22222222-2222-4222-8222-222222222222",
          name: "Platform",
          tag: FeatureTag.Product,
        },
        {
          featureId: deepFeature.id,
          name: deepFeature.name,
          tag: FeatureTag.Infra,
          parentFeatureId: "22222222-2222-4222-8222-222222222222",
        },
      ],
    },
  ],
};

const config: FieldConfig = {
  field: "repository_placement_review",
  description: "Review placement",
  type: "repository_placement_review",
  payload,
};

const context = {
  conversationId: "conversation",
  projectId: "project",
  organizationId: "organization",
  interaction: {},
} as FieldComponentContext;

const renderField = ({
  isSubmitted = false,
  onChange = vi.fn(),
  onValidityChange,
}: {
  isSubmitted?: boolean;
  onChange?: ReturnType<typeof vi.fn>;
  onValidityChange?: ReturnType<typeof vi.fn>;
} = {}) => {
  const value = createRepositoryPlacementReviewValue(payload);
  const renderResult = render(
    <RepositoryPlacementReviewField
      config={config}
      value={value}
      onChange={onChange}
      onValidityChange={onValidityChange}
      context={context}
      isSubmitted={isSubmitted}
    />
  );
  return { onChange, value, ...renderResult };
};

describe("RepositoryPlacementReviewField", () => {
  beforeEach(() => {
    vi.mocked(unifiedApiClient.getTask).mockReset();
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
      referencesResponse([
        ...payload.roots.flatMap((root) =>
          root.selectedParentLineage.map((item) => ({
            ...deepFeature,
            id: item.featureId,
            name: item.name,
            tag: item.tag,
            parentTaskId: item.parentFeatureId,
          }))
        ),
        deepFeature,
        isolatedParent,
        isolatedFeature,
      ]) as never
    );
    vi.mocked(unifiedApiClient.getTasks).mockResolvedValue({
      data: {
        data: [
          ...payload.roots.flatMap((root) =>
            root.selectedParentLineage.map((item) => ({
              ...deepFeature,
              id: item.featureId,
              name: item.name,
              tag: item.tag,
              parentTaskId: item.parentFeatureId,
            }))
          ),
          deepFeature,
          isolatedParent,
          isolatedFeature,
        ],
      },
    } as never);
  });

  it("renders every root with its complete lineage and unchanged descendants", () => {
    renderField();

    const roots = screen.getAllByTestId("repository-placement-review-root");
    expect(roots).toHaveLength(2);
    expect(within(roots[0]).getByText("Product")).toBeInTheDocument();
    expect(within(roots[0]).getByText("Analytics")).toBeInTheDocument();
    expect(within(roots[0]).getByText("Insights")).toBeInTheDocument();
    expect(within(roots[0]).getByText("Dashboard")).toBeInTheDocument();
    expect(within(roots[0]).getByText("Metrics API")).toBeInTheDocument();
    expect(
      within(roots[0]).getByTestId("feature-list-children")
    ).toBeInTheDocument();
    expect(
      within(roots[0]).getAllByTestId("feature-list-child-card")
    ).toHaveLength(2);
    expect(within(roots[1]).getByText("Platform")).toBeInTheDocument();
    expect(within(roots[1]).getByText("Operations")).toBeInTheDocument();
    expect(within(roots[1]).getByText("Alerts")).toBeInTheDocument();
    expect(within(roots[1]).getByText("Alert Rules")).toBeInTheDocument();
  });

  it("emits only the edited root override and immediately renders its known deep lineage", () => {
    const { onChange, value, rerender } = renderField();
    const originalPayload = JSON.stringify(payload);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Parent for Insights choose Operations",
      })
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      action: "APPROVED",
      payload: {
        overrides: [
          {
            rootKey: "insights-root",
            target: {
              kind: "EXISTING_FEATURE",
              featureId: deepFeature.id,
            },
          },
          value.payload.overrides[1],
        ],
      },
    });

    const nextValue = onChange.mock.calls[0][0];
    rerender(
      <RepositoryPlacementReviewField
        config={config}
        value={nextValue}
        onChange={onChange}
        context={context}
        isSubmitted={false}
      />
    );
    const updatedRoot = screen
      .getAllByTestId("repository-placement-review-root")
      .find((root) => root.dataset.rootKey === "insights-root");
    expect(updatedRoot).toBeDefined();
    expect(within(updatedRoot!).getByText("Platform")).toBeInTheDocument();
    expect(within(updatedRoot!).getByText("Operations")).toBeInTheDocument();
    expect(within(updatedRoot!).getByText("Dashboard")).toBeInTheDocument();
    expect(within(updatedRoot!).getByText("Metrics API")).toBeInTheDocument();
    expect(JSON.stringify(payload)).toBe(originalPayload);
  });

  it("supports Project root without changing sibling roots or proposed children", () => {
    const { onChange, value } = renderField();
    const projectRootButtons = screen.getAllByTestId(
      "repository-placement-project-root"
    );
    fireEvent.click(projectRootButtons[0]);

    expect(onChange).toHaveBeenCalledWith({
      action: "APPROVED",
      payload: {
        overrides: [
          {
            rootKey: "insights-root",
            target: { kind: "PROJECT_ROOT" },
          },
          value.payload.overrides[1],
        ],
      },
    });
  });

  it("loads and renders the complete lineage for a parent outside the supplied lineages", async () => {
    vi.mocked(unifiedApiClient.getTask).mockResolvedValue({
      data: { success: true, data: isolatedParent },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
    const { onChange, rerender } = renderField();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Parent for Insights choose Support",
      })
    );
    const nextValue = onChange.mock.calls[0][0];
    rerender(
      <RepositoryPlacementReviewField
        config={config}
        value={nextValue}
        onChange={onChange}
        context={context}
        isSubmitted={false}
      />
    );

    const updatedRoot = screen
      .getAllByTestId("repository-placement-review-root")
      .find((root) => root.dataset.rootKey === "insights-root");
    expect(updatedRoot).toBeDefined();
    await waitFor(() => {
      expect(
        within(updatedRoot!).getByText("Customer Experience")
      ).toBeInTheDocument();
    });
    expect(within(updatedRoot!).getByText("Support")).toBeInTheDocument();
    expect(within(updatedRoot!).getByText("Dashboard")).toBeInTheDocument();
    expect(unifiedApiClient.getTask).not.toHaveBeenCalled();
    expect(unifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: [isolatedParent.id, isolatedFeature.id],
        includeSectionKeys: undefined,
      })
    );
  });

  it.each(["request failure", "missing tag"])(
    "blocks submission when an edited parent's lineage has %s",
    async (failure) => {
      if (failure === "request failure")
        vi.mocked(unifiedApiClient.getTasks).mockRejectedValue(
          new Error("lineage unavailable")
        );
      else
        vi.mocked(unifiedApiClient.getTasks).mockResolvedValue({
          data: {
            data: [{ ...isolatedParent, tag: undefined }, isolatedFeature],
          },
        } as never);
      const onValidityChange = vi.fn();
      const { onChange, rerender } = renderField({ onValidityChange });

      fireEvent.click(
        screen.getByRole("button", {
          name: "Parent for Insights choose Support",
        })
      );
      rerender(
        <RepositoryPlacementReviewField
          config={config}
          value={onChange.mock.calls[0][0]}
          onChange={onChange}
          onValidityChange={onValidityChange}
          context={context}
          isSubmitted={false}
        />
      );

      await waitFor(() => {
        expect(onValidityChange).toHaveBeenLastCalledWith("invalid");
      });
      expect(
        screen.getByText("Complete parent lineage is unavailable.")
      ).toBeInTheDocument();
    }
  );

  it("is read-only after submission and performs no work on attempted edits", () => {
    const { onChange } = renderField({ isSubmitted: true });

    expect(
      screen.getByRole("button", {
        name: "Parent for Insights choose Operations",
      })
    ).toBeDisabled();
    expect(
      screen.getAllByTestId("repository-placement-project-root")[0]
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Parent for Insights choose Operations",
      })
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
