import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityPromptTemplatesPanel } from "./EntityPromptTemplatesPanel";

const mocks = vi.hoisted(() => ({
  templates: vi.fn(),
  proposals: vi.fn(),
  proposalProjection: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useEntityPromptTemplates: (...args: unknown[]) => mocks.templates(...args),
  useProposals: (...args: unknown[]) => mocks.proposals(...args),
  useEntityPromptTemplateProposal: (...args: unknown[]) =>
    mocks.proposalProjection(...args),
  useCreateEntityPromptTemplateChangeProposal: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateEntityPromptTemplateRetirementProposal: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

const canonicalRevision = {
  templateKey: "entity_context",
  revisionId: "canonical-id",
  revisionNumber: 1,
  content: "Canonical content",
  ownershipScope: { scope: "CANONICAL" },
  lifecycleState: "PUBLISHED",
  validation: { status: "VALID", issues: [] },
};

const template = {
  templateKey: "entity_context",
  canonicalDefault: canonicalRevision,
  revisionHistory: [canonicalRevision],
  effective: {
    templateKey: "entity_context",
    revisionId: "canonical-id",
    revisionNumber: 1,
    content: "Canonical content",
    ownershipSource: { scope: "CANONICAL" },
    lifecycleState: "PUBLISHED",
    validationStatus: "VALID",
    selector: { entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" },
    syntaxVersion: "V1",
    publishedAt: "2026-08-21T00:00:00.000Z",
  },
};

describe("EntityPromptTemplatesPanel", () => {
  beforeEach(() => {
    mocks.templates.mockReturnValue({
      catalog: { projectId: "project-1", templates: [template] },
      isLoading: false,
      isReady: true,
      isFetched: true,
      error: null,
    });
    mocks.proposals.mockReturnValue({ data: [], error: null });
    mocks.proposalProjection.mockReturnValue({ proposal: null });
  });

  it("opens a template from the list and returns with the back button", async () => {
    const user = userEvent.setup();
    render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );

    expect(mocks.templates).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(
      screen.getByTestId("entity-prompt-templates-list")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-prompt-template-card")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Entity Context/ }));

    expect(
      screen.getByTestId("entity-prompt-template-detail")
    ).toBeInTheDocument();
    expect(mocks.proposals).toHaveBeenCalledWith("org-1", "project-1", {
      targetEntityType: "ENTITY_PROMPT_TEMPLATE",
      targetEntityId: "entity_context",
    });
    const effective = screen.getByTestId("entity-prompt-template-effective");
    expect(effective).toHaveTextContent("Source: Canonical default");
    expect(effective).toHaveTextContent("Revision 1");
    expect(effective).toHaveTextContent("Published");
    expect(
      screen.getByTestId("entity-prompt-template-heading")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entity Context" })).toBe(
      screen.getByTestId("entity-prompt-template-heading").firstElementChild
    );
    expect(
      screen.getByTestId("entity-prompt-template-help-trigger")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Agent Prompt Composition")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-prompt-template-editor-input")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("entity-prompt-template-edit")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-prompt-template-standard")
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/publish revision/i)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("entity-prompt-template-help-trigger"));
    expect(
      screen.getByRole("dialog", {
        name: "How this template participates in the agent prompt",
      })
    ).toHaveTextContent("Agent Prompt Composition");

    await user.click(screen.getByTestId("entity-prompt-template-help-close"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("entity-prompt-template-help-dialog")
      ).not.toBeInTheDocument()
    );

    await user.click(screen.getByTestId("entity-prompt-template-help-trigger"));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByTestId("entity-prompt-template-help-dialog")
      ).not.toBeInTheDocument()
    );

    await user.click(screen.getByTestId("entity-prompt-template-back"));
    expect(
      screen.getByTestId("entity-prompt-templates-list")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-prompt-template-card")
    ).not.toBeInTheDocument();
  });

  it("renders missing scope and catalog failures", () => {
    const { rerender } = render(
      <EntityPromptTemplatesPanel
        organizationId={undefined}
        projectId="project-1"
      />
    );
    expect(
      screen.getByTestId("entity-prompt-templates-missing-scope")
    ).toBeInTheDocument();
    expect(mocks.templates).toHaveBeenLastCalledWith(undefined);
    expect(
      screen.queryByTestId("entity-prompt-templates-loading")
    ).not.toBeInTheDocument();

    mocks.templates.mockReturnValue({
      catalog: null,
      isLoading: false,
      isReady: false,
      isFetched: true,
      error: new Error("catalog unavailable"),
    });
    rerender(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(
      screen.getByTestId("entity-prompt-templates-error")
    ).toHaveTextContent("catalog unavailable");
  });

  it("renders distinct loading and empty catalog outcomes", () => {
    mocks.templates.mockReturnValue({
      catalog: null,
      isLoading: true,
      isReady: false,
      isFetched: false,
      error: null,
    });
    const { rerender } = render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(
      screen.getByTestId("entity-prompt-templates-loading")
    ).toBeInTheDocument();

    mocks.templates.mockReturnValue({
      catalog: { projectId: "project-1", templates: [] },
      isLoading: false,
      isReady: true,
      isFetched: true,
      error: null,
    });
    rerender(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(
      screen.getByTestId("entity-prompt-templates-empty")
    ).toBeInTheDocument();
  });

  it("lists every template in the authoritative catalog", () => {
    mocks.templates.mockReturnValue({
      catalog: {
        projectId: "project-1",
        templates: [template, { ...template, templateKey: "plan_context" }],
      },
      isLoading: false,
      isReady: true,
      isFetched: true,
      error: null,
    });

    render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    expect(
      screen.getAllByTestId("entity-prompt-template-list-item")
    ).toHaveLength(2);
  });

  it("shows the canonical standard only when the effective source is a project override", async () => {
    const user = userEvent.setup();
    const projectTemplate = {
      ...template,
      effective: {
        ...template.effective,
        revisionId: "project-id",
        revisionNumber: 3,
        content: "Project content",
        ownershipSource: { scope: "PROJECT", projectId: "project-1" },
      },
    };
    mocks.templates.mockReturnValue({
      catalog: { projectId: "project-1", templates: [projectTemplate] },
      isLoading: false,
      isReady: true,
      isFetched: true,
      error: null,
    });

    render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    await user.click(screen.getByRole("button", { name: /Entity Context/ }));

    expect(
      screen.getByTestId("entity-prompt-template-current")
    ).toHaveTextContent("Project content");
    expect(
      screen.getByTestId("entity-prompt-template-standard")
    ).toHaveTextContent("Canonical content");
  });

  it("locks duplicate changes while a matching proposal is pending", async () => {
    const user = userEvent.setup();
    const pendingProposal = {
      id: "pending-proposal",
      type: "ENTITY_PROMPT_TEMPLATE",
      status: "DRAFT",
      updates: { operation: "UPSERT", content: "Pending content" },
    };
    mocks.proposals.mockReturnValue({ data: [pendingProposal], error: null });
    mocks.proposalProjection.mockReturnValue({ proposal: pendingProposal });

    render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );

    await user.click(screen.getByRole("button", { name: /Entity Context/ }));

    await waitFor(() =>
      expect(screen.getByTestId("entity-prompt-template-edit")).toBeDisabled()
    );
    const notice = screen.getByTestId(
      "entity-prompt-template-pending-proposal-notice"
    );
    const proposalLink = screen.getByTestId(
      "entity-prompt-template-proposal-link"
    );
    const metadata = screen.getByTestId(
      "entity-prompt-template-current-metadata"
    );
    expect(notice).toHaveTextContent(
      "There is a current proposal. Either accept or reject it before making further edits."
    );
    expect(notice.compareDocumentPosition(proposalLink)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(proposalLink.compareDocumentPosition(metadata)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(
      screen.queryByTestId("entity-prompt-template-propose-change")
    ).not.toBeInTheDocument();
  });

  it("returns rejected revisions to authoritative content after approval", async () => {
    const user = userEvent.setup();
    const rejectedProposal = {
      id: "rejected-proposal",
      type: "ENTITY_PROMPT_TEMPLATE",
      status: "REJECTED",
      updates: { operation: "UPSERT", content: "Rejected content" },
    };
    mocks.proposals.mockReturnValue({ data: [rejectedProposal], error: null });
    mocks.proposalProjection.mockReturnValue({ proposal: rejectedProposal });

    const { rerender } = render(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );
    await user.click(screen.getByRole("button", { name: /Entity Context/ }));
    await user.click(
      screen.getByTestId("entity-prompt-template-revise-rejected")
    );
    expect(
      screen.getByTestId("entity-prompt-template-editor-input")
    ).toHaveTextContent("Rejected content");

    const approvedTemplate = {
      ...template,
      effective: {
        ...template.effective,
        revisionId: "approved-id",
        revisionNumber: 2,
        content: "New authoritative content",
      },
    };
    mocks.templates.mockReturnValue({
      catalog: { projectId: "project-1", templates: [approvedTemplate] },
      isLoading: false,
      isReady: true,
      isFetched: true,
      error: null,
    });
    rerender(
      <EntityPromptTemplatesPanel
        organizationId="org-1"
        projectId="project-1"
      />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("entity-prompt-template-current-content")
      ).toHaveTextContent("New authoritative content")
    );
    expect(
      screen.queryByTestId("entity-prompt-template-editor-input")
    ).not.toBeInTheDocument();
  });
});
