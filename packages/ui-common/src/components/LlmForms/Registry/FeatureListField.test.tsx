import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FeatureListProposalNode,
  RepositoryGroundingSuccess,
} from "../../../api";
import { FeatureListField } from "./FeatureListField";
import type { FieldComponentContext, FieldConfig } from "./types";
import type { FeatureListValue } from "./types";

const useServicesMock = vi.fn();

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: (...args: unknown[]) => useServicesMock(...args),
}));

vi.mock("../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({ mention }: { mention: { entityName: string } }) => (
    <span data-testid="mention-badge">{mention.entityName}</span>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue: string | { [k: string]: unknown },
      options?: Record<string, unknown>,
    ) => {
      const fallback =
        typeof defaultValue === "string"
          ? defaultValue
          : ((defaultValue as { defaultValue?: string })?.defaultValue ?? "");
      if (!options) return fallback;
      return Object.entries(options).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

const mockConfig: FieldConfig = {
  field: "feature-list",
  description: "Feature list",
  type: "feature_list",
};

const mockContext: FieldComponentContext = {
  conversationId: "conv-1",
  projectId: "proj-1",
  organizationId: "org-1",
};

const widgets: FeatureListProposalNode = {
  id: "top-widgets",
  name: "Widgets",
  description: "User-facing widget surface",
  children: [
    {
      id: "child-ordering",
      name: "Ordering",
      description: "Place widget orders",
      children: [],
    },
    {
      id: "child-customization",
      name: "Customization",
      description: "Customize widget shape",
      children: [],
    },
  ],
};

const widgetFactory: FeatureListProposalNode = {
  id: "top-factory",
  name: "Widget Factory",
  description: "Internal build pipeline",
  children: [
    {
      id: "child-intake",
      name: "Intake",
      description: "Receive build requests",
      children: [],
    },
    {
      id: "child-assembly",
      name: "Assembly",
      description: "Assemble widgets",
      children: [],
    },
  ],
};

const buildValue = (
  overrides: Partial<FeatureListValue> = {},
): FeatureListValue => ({
  type: "FEATURE_LIST",
  generatedProposalIds: [widgets.id, widgetFactory.id],
  narrative: "Your project delivers Widgets and Widget Factory.",
  topLevels: [widgets, widgetFactory],
  refinement: { sections: {}, overall: "" },
  ...overrides,
});

const repositoryCompletion: RepositoryGroundingSuccess = {
  outcome: "success",
  serviceId: "service-1",
  provider: "OpenAI",
  resolvedFrontierModel: "gpt-5.1",
  narrative: "The repository describes a collaborative workspace.",
  hierarchy: {
    topLevels: [],
  },
  evidence: [
    {
      path: "src/workspace.ts",
      summary: "Defines the workspace boundary.",
      lineStart: 10,
      lineEnd: 20,
    },
  ],
  briefDiscrepancies: [
    {
      summary: "The implementation includes an additional workspace surface.",
      rationale: "The bounded evidence shows behavior beyond the brief.",
      material: true,
      evidencePaths: ["src/workspace.ts"],
    },
  ],
};

describe("FeatureListField", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    useServicesMock.mockReset();
    useServicesMock.mockReturnValue({
      services: [{ id: "service-1", name: "UI Common" }],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });
  });

  it("renders the narrative above the sections", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue()}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    expect(screen.getByTestId("feature-list-narrative")).toHaveTextContent(
      "Your project delivers Widgets and Widget Factory.",
    );
  });

  it("renders each top-level as a section with its description and children", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue()}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const widgetsSection = screen.getByTestId(
      `feature-list-section-${widgets.id}`,
    );
    expect(widgetsSection).toHaveTextContent("Widgets");
    expect(widgetsSection).toHaveTextContent("User-facing widget surface");
    expect(widgetsSection).toHaveTextContent("Ordering");
    expect(widgetsSection).toHaveTextContent("Place widget orders");
    expect(widgetsSection).toHaveTextContent("Customization");

    const factorySection = screen.getByTestId(
      `feature-list-section-${widgetFactory.id}`,
    );
    expect(factorySection).toHaveTextContent("Widget Factory");
    expect(factorySection).toHaveTextContent("Intake");
    expect(factorySection).toHaveTextContent("Assembly");
  });

  it("uses proposal metadata for parents and icon titles for children", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue()}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const proposalMetadata = screen.getAllByTestId(
      "feature-list-proposal-metadata",
    );
    expect(proposalMetadata).toHaveLength(2);

    for (const metadata of proposalMetadata) {
      expect(
        within(metadata).getByTestId("proposal-header-action"),
      ).toHaveTextContent("Create");
      expect(
        within(metadata).getByTestId("proposal-header-type"),
      ).toHaveTextContent("Feature");
    }

    const widgetsSection = screen.getByTestId(
      `feature-list-section-${widgets.id}`,
    );
    expect(
      within(widgetsSection).getAllByTestId("feature-list-proposal-metadata"),
    ).toHaveLength(1);

    const childCards = screen.getAllByTestId("feature-list-child-card");
    expect(childCards).toHaveLength(4);
    for (const childCard of childCards) {
      expect(
        within(childCard).getByTestId("feature-list-child-icon"),
      ).toBeInTheDocument();
      expect(
        within(childCard).queryByTestId("feature-list-proposal-metadata"),
      ).not.toBeInTheDocument();
    }

    expect(
      within(widgetsSection).getByTestId("feature-list-children"),
    ).toBeInTheDocument();
  });

  it("typing in a per-section textarea writes to refinement.sections keyed by top-level id", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue()}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const sectionInput = screen
      .getByTestId(`feature-list-section-input-${widgetFactory.id}`)
      .querySelector("textarea");
    expect(sectionInput).not.toBeNull();
    fireEvent.change(sectionInput!, {
      target: { value: "Marketing should be its own thing" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FeatureListValue;
    expect(next.refinement.sections).toEqual({
      [widgetFactory.id]: "Marketing should be its own thing",
    });
    expect(next.refinement.overall).toBe("");
    expect(next).not.toHaveProperty("nextAction");
  });

  it("typing in the overall textarea writes to refinement.overall", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue()}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const overallInput = screen
      .getByTestId("feature-list-overall-input")
      .querySelector("textarea");
    expect(overallInput).not.toBeNull();
    fireEvent.change(overallInput!, {
      target: { value: "Merge the two top-levels" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FeatureListValue;
    expect(next.refinement.overall).toBe("Merge the two top-levels");
    expect(next.refinement.sections).toEqual({});
  });

  it("preserves existing section feedback when typing in another section", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          refinement: {
            sections: { [widgets.id]: "Add a returns child" },
            overall: "",
          },
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const factoryInput = screen
      .getByTestId(`feature-list-section-input-${widgetFactory.id}`)
      .querySelector("textarea");
    fireEvent.change(factoryInput!, { target: { value: "QA needs a child" } });

    const next = onChange.mock.calls[0][0] as FeatureListValue;
    expect(next.refinement.sections).toEqual({
      [widgets.id]: "Add a returns child",
      [widgetFactory.id]: "QA needs a child",
    });
  });

  it("renders the lean repository evidence envelope beside the review", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent("Service: UI Common");
    expect(summary).not.toHaveTextContent("service-1");
    expect(summary).toHaveTextContent("Provider: OpenAI");
    expect(summary).toHaveTextContent("Model: gpt-5.1");
    expect(summary).toHaveTextContent(
      "OpenAI usage: Repository analysis with evidence-backed capability synthesis and coherence review.",
    );
    expect(summary).not.toHaveTextContent("repository_analysis");
    expect(summary).toHaveTextContent("src/workspace.ts:10-20");
    expect(summary).toHaveTextContent("Service-brief discrepancies");
    expect(summary).not.toHaveTextContent("Applied bounds");
    expect(summary).not.toHaveTextContent("Omissions and exclusions");
    expect(summary).not.toHaveTextContent("Confidence and rationale");
    expect(summary).not.toHaveTextContent("Coherence changes");
  });

  it("resolves Service names and renders discrepancy mentions through the shared renderer", () => {
    const mentionToken =
      "@[feature:5439da43-74a1-43a5-816e-a700d4433a5b|Repository Import]";
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: {
            ...repositoryCompletion,
            briefDiscrepancies: [
              {
                ...repositoryCompletion.briefDiscrepancies[0],
                summary: `The result references ${mentionToken}.`,
                rationale: `Review ${mentionToken} before accepting the result.`,
              },
            ],
          },
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent("Service: UI Common");
    expect(summary).toHaveTextContent(
      "The result references Repository Import.",
    );
    expect(summary).toHaveTextContent(
      "Review Repository Import before accepting the result.",
    );
    expect(summary).not.toHaveTextContent(mentionToken);
    expect(within(summary).getAllByTestId("mention-badge")).toHaveLength(2);
  });

  it("shows a loading state instead of the Service identifier while the catalog resolves", () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: true,
      isFetching: true,
      isFetched: false,
      error: null,
    });

    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent("Service: Loading Services…");
    expect(summary).not.toHaveTextContent("service-1");
  });

  it("shows an unavailable state instead of the Service identifier when the catalog has no match", () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });

    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent(
      "Service: The selected Service is unavailable in this project.",
    );
    expect(summary).not.toHaveTextContent("service-1");
  });

  it("shows an error state instead of the Service identifier when the catalog fails", () => {
    useServicesMock.mockReturnValue({
      services: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: new Error("Service catalog failed"),
    });

    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent(
      "Service: The Service could not be loaded for this evidence.",
    );
    expect(summary).not.toHaveTextContent("service-1");
  });

  it("keeps explicit empty states for lean evidence details", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: {
            ...repositoryCompletion,
            evidence: [],
            briefDiscrepancies: [],
          },
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const summary = screen.getByTestId("feature-list-repository-evidence");
    expect(summary).toHaveTextContent(
      "No repository evidence references were supplied by the result.",
    );
    expect(summary).toHaveTextContent(
      "No service-brief discrepancies were reported by the result.",
    );
  });

  it("preserves repository evidence when feedback changes", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    const overallInput = screen
      .getByTestId("feature-list-overall-input")
      .querySelector("textarea");
    fireEvent.change(overallInput!, { target: { value: "Rebucket this" } });

    const next = onChange.mock.calls[0][0] as FeatureListValue;
    expect(next.repositoryGroundingCompletion).toEqual(repositoryCompletion);
  });

  it("shows repository evidence even when the hierarchy is empty", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({
          topLevels: [],
          generatedProposalIds: [],
          repositoryGroundingCompletion: repositoryCompletion,
        })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    expect(
      screen.getByTestId("feature-list-repository-evidence"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No features have been generated yet."),
    ).toBeInTheDocument();
  });

  it("renders the empty-state alert when there are no top-levels", () => {
    render(
      <FeatureListField
        config={mockConfig}
        value={buildValue({ topLevels: [], generatedProposalIds: [] })}
        onChange={onChange}
        isSubmitted={false}
        context={mockContext}
      />,
    );

    expect(
      screen.getByText("No features have been generated yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-list-overall-input"),
    ).not.toBeInTheDocument();
  });
});
