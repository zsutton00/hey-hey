import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProposalResponseDto } from "@hey-hey/ui-common/api";
import { EntityPromptTemplateProposalActions } from "./EntityPromptTemplateProposalActions";

vi.mock("@hey-hey/ui-common/data", () => ({
  useEntityPromptTemplateProposal: (proposal: ProposalResponseDto) => ({
    proposal: proposal.type === "ENTITY_PROMPT_TEMPLATE" ? proposal : null,
    error: null,
    isLoading: false,
  }),
}));

const makeProposal = (
  id: string,
  status: string,
  content = "Rejected candidate"
): ProposalResponseDto =>
  ({
    id,
    type: "ENTITY_PROMPT_TEMPLATE",
    status,
    updates: {
      operation: "UPSERT",
      content,
    },
  } as ProposalResponseDto);

describe("EntityPromptTemplateProposalActions", () => {
  it("renders proposal links and restores rejected content", async () => {
    const user = userEvent.setup();
    const onReviseRejected = vi.fn();
    render(
      <EntityPromptTemplateProposalActions
        organizationId="org-1"
        projectId="project-1"
        proposals={[
          makeProposal("pending-proposal", "DRAFT"),
          makeProposal("rejected-proposal", "REJECTED"),
        ]}
        templateKey="entity_context"
        selector={{ entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" }}
        onReviseRejected={onReviseRejected}
      />
    );

    const proposalLinks = screen.getAllByTestId(
      "entity-prompt-template-proposal-link"
    );
    expect(proposalLinks).toHaveLength(2);
    expect(
      screen.getByTestId("entity-prompt-template-pending-proposal-notice")
    ).toHaveTextContent(
      "There is a current proposal. Either accept or reject it before making further edits."
    );
    expect(proposalLinks[0]).toHaveAttribute(
      "href",
      "/projects/project-1/proposals/pending-proposal"
    );
    expect(
      screen.queryByTestId("standard-proposal-detail")
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByTestId("entity-prompt-template-revise-rejected")
    );
    expect(onReviseRejected).toHaveBeenCalledWith("Rejected candidate");
  });

  it("renders proposal loading errors", () => {
    render(
      <EntityPromptTemplateProposalActions
        organizationId="org-1"
        projectId="project-1"
        proposals={[]}
        error={new Error("proposal service unavailable")}
        templateKey="entity_context"
        selector={{ entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" }}
        onReviseRejected={vi.fn()}
      />
    );
    expect(
      screen.getByTestId("entity-prompt-template-proposals-error")
    ).toHaveTextContent("proposal service unavailable");
  });

  it("reports only matching pending template operations", async () => {
    const onPendingOperationChange = vi.fn();
    render(
      <EntityPromptTemplateProposalActions
        organizationId="org-1"
        projectId="project-1"
        proposals={[makeProposal("pending-proposal", "DRAFT")]}
        templateKey="entity_context"
        selector={{ entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" }}
        onReviseRejected={vi.fn()}
        onPendingOperationChange={onPendingOperationChange}
      />
    );

    await waitFor(() =>
      expect(onPendingOperationChange).toHaveBeenCalledWith(
        "pending-proposal",
        "UPSERT"
      )
    );
  });
});
