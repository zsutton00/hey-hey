import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityPromptTemplateCatalogEntryDto } from "@hey-hey/ui-common/api";
import { EntityPromptTemplatePublicationActions } from "./EntityPromptTemplatePublicationActions";

const mocks = vi.hoisted(() => ({
  retire: vi.fn(),
  onProposalCreated: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useCreateEntityPromptTemplateRetirementProposal: () => ({
    mutate: mocks.retire,
    isPending: false,
  }),
}));

const makeTemplate = (withOverride: boolean) =>
  ({
    templateKey: "entity_context",
    canonicalDefault: {},
    revisionHistory: [],
    projectOverride: withOverride
      ? { revisionId: "override-id", revisionNumber: 7 }
      : undefined,
    effective: {
      revisionId: "override-id",
      revisionNumber: 7,
      selector: { entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" },
      syntaxVersion: "V1",
    },
  } as EntityPromptTemplateCatalogEntryDto);

const renderActions = (withOverride = true) =>
  render(
    <EntityPromptTemplatePublicationActions
      organizationId="org-1"
      projectId="project-1"
      template={makeTemplate(withOverride)}
      selector={{ entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" }}
      onProposalCreated={mocks.onProposalCreated}
    />
  );

describe("EntityPromptTemplatePublicationActions", () => {
  beforeEach(() => {
    mocks.retire.mockReset();
    mocks.onProposalCreated.mockReset();
  });

  it("keeps the active override visible and proposes retirement after confirmation", async () => {
    const user = userEvent.setup();
    mocks.retire.mockResolvedValue({ id: "proposal-1" });
    renderActions();

    await user.click(
      screen.getByTestId("entity-prompt-template-propose-retirement")
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Until then, this project override remains authoritative"
    );
    await user.click(
      screen.getByTestId("entity-prompt-template-retire-confirm")
    );

    expect(mocks.retire).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      templateKey: "entity_context",
      selector: { entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" },
      expectedEffectiveRevision: {
        revisionId: "override-id",
        revisionNumber: 7,
      },
    });
    expect(
      screen.getByTestId("entity-prompt-template-retirement-success")
    ).toHaveTextContent("remains effective until approval");
    expect(mocks.onProposalCreated).toHaveBeenCalledWith({ id: "proposal-1" });
  });

  it("does not offer retirement without an active project override", () => {
    renderActions(false);
    expect(
      screen.queryByTestId("entity-prompt-template-retirement-actions")
    ).not.toBeInTheDocument();
  });

  it("prevents duplicate retirement proposals", async () => {
    mocks.retire.mockResolvedValue({ id: "proposal-1" });
    renderActions();
    fireEvent.click(
      screen.getByTestId("entity-prompt-template-propose-retirement")
    );
    const confirm = screen.getByTestId("entity-prompt-template-retire-confirm");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.retire).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByTestId("entity-prompt-template-retirement-success")
      ).toBeInTheDocument()
    );
  });
});
