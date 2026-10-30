import { EntityPromptTemplatesApi } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { EntityPromptTemplateCatalogEntryDto } from "@hey-hey/ui-common/api";
import { EntityPromptTemplateOverrideEditor } from "./EntityPromptTemplateOverrideEditor";

const mocks = vi.hoisted(() => ({ create: vi.fn(), validate: vi.fn() }));
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null });
});

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useCreateEntityPromptTemplateChangeProposal: () => ({
    mutate: mocks.create,
    isPending: false,
  }),
}));

const template = {
  templateKey: "entity_context",
  canonicalDefault: {
    templateKey: "entity_context",
    revisionId: "canonical-revision-id",
    revisionNumber: 1,
    content: "Canonical entity context",
    ownershipScope: { scope: "CANONICAL" },
    lifecycleState: "PUBLISHED",
    validation: { status: "VALID", issues: [] },
  },
  revisionHistory: [],
  effective: {
    templateKey: "entity_context",
    revisionId: "effective-revision-id",
    revisionNumber: 4,
    content: "Authoritative effective content",
    selector: { entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" },
    syntaxVersion: "V1",
    ownershipSource: { scope: "PROJECT", projectId: "project-1" },
    lifecycleState: "PUBLISHED",
    validationStatus: "VALID",
    publishedAt: "2026-08-21T00:00:00.000Z",
  },
} as EntityPromptTemplateCatalogEntryDto;

const renderEditor = (
  rejectedContent?: string,
  paletteMode: "light" | "dark" = "light",
) =>
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: paletteMode } })}>
      <EntityPromptTemplateOverrideEditor
        organizationId="org-1"
        projectId="project-1"
        template={template}
        selector={template.effective.selector}
        syntaxVersion={template.effective.syntaxVersion}
        rejectedContent={rejectedContent}
        proposals={[]}
        proposalsError={null}
        onReviseRejected={vi.fn()}
        onPendingOperationChange={vi.fn()}
      />
    </ThemeProvider>,
  );

describe("EntityPromptTemplateOverrideEditor", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.validate
      .mockReset()
      .mockResolvedValue({ data: { data: { status: "VALID", issues: [] } } });
    vi.spyOn(
      EntityPromptTemplatesApi.prototype,
      "validateEntityPromptTemplateDraft",
    ).mockImplementation(mocks.validate);
  });

  it("keeps generated field help visible alongside authoritative template state", () => {
    renderEditor();

    expect(
      screen.getByTestId("entity-prompt-template-language-help"),
    ).toHaveTextContent("entity.sections.<key>");
    expect(
      screen.queryByRole("heading", { name: "Current" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("entity-prompt-template-current-metadata"),
    ).toHaveTextContent("Source: Project override");
    expect(
      screen.getByTestId("entity-prompt-template-current-metadata"),
    ).toHaveTextContent("Revision 4");
    expect(
      screen.getByTestId("entity-prompt-template-current-metadata"),
    ).toHaveTextContent("Validation: VALID");
    expect(
      screen.getByTestId("entity-prompt-template-language-help"),
    ).toHaveTextContent("Supported Fields");
    expect(
      screen.queryByTestId("entity-prompt-template-editor-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("entity-prompt-template-standard"),
    ).toHaveTextContent("Canonical entity context");

    const content = screen.getByTestId(
      "entity-prompt-template-current-content",
    );
    const edit = screen.getByTestId("entity-prompt-template-edit");
    const metadata = screen.getByTestId(
      "entity-prompt-template-current-metadata",
    ).parentElement;
    expect(content.nextElementSibling).toBe(edit);
    expect(edit.nextElementSibling).toBe(metadata);
  });

  it("does not render a canonical standard for a project-owned custom key", () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <EntityPromptTemplateOverrideEditor
          organizationId="org-1"
          projectId="project-1"
          template={{ ...template, canonicalDefault: undefined }}
          selector={template.effective.selector}
          syntaxVersion={template.effective.syntaxVersion}
          proposals={[]}
          proposalsError={null}
          onReviseRejected={vi.fn()}
          onPendingOperationChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(
      screen.queryByTestId("entity-prompt-template-standard"),
    ).not.toBeInTheDocument();
  });

  it("enters edit mode explicitly, shows generated path help, and cancels local changes", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByTestId("entity-prompt-template-edit"));
    expect(
      screen.getByTestId("entity-prompt-template-editor-input"),
    ).toHaveTextContent("Authoritative effective content");
    expect(
      screen.getByTestId("entity-prompt-template-language-help"),
    ).toHaveTextContent("entity.name");
    expect(
      screen.getByTestId("entity-prompt-template-language-help"),
    ).toHaveTextContent("entity.sections.<key>");

    await user.clear(screen.getByTestId("entity-prompt-template-editor-input"));
    await user.type(
      screen.getByTestId("entity-prompt-template-editor-input"),
      "Local edit",
    );
    await user.click(screen.getByTestId("entity-prompt-template-edit-cancel"));

    expect(
      screen.queryByTestId("entity-prompt-template-editor-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("entity-prompt-template-current-content"),
    ).toHaveTextContent("Authoritative effective content");
  });

  it("starts from authoritative effective content and creates a complete proposal", async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ id: "proposal-1" });
    renderEditor();

    await user.click(screen.getByTestId("entity-prompt-template-edit"));
    const input = screen.getByTestId("entity-prompt-template-editor-input");
    expect(input).toHaveTextContent("Authoritative effective content");
    await user.click(input);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.paste("Proposed replacement");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Explain this change in one sentence",
      }),
      { target: { value: "Improve the project context." } },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("entity-prompt-template-propose-change"),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByTestId("entity-prompt-template-propose-change"),
    );

    expect(mocks.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      templateKey: "entity_context",
      selector: { entityType: "WORK_ITEM", workItemTypeKey: "FEATURE" },
      syntaxVersion: "V1",
      content: "Proposed replacement",
      eli5: "Improve the project context.",
      expectedEffectiveRevision: {
        revisionId: "effective-revision-id",
        revisionNumber: 4,
      },
    });
    expect(
      screen.getByTestId("entity-prompt-template-proposal-success"),
    ).toHaveTextContent("effective template will change only after approval");
    expect(
      screen.queryByText(/validate saved revision/i),
    ).not.toBeInTheDocument();
  });

  it("restores rejected content and retains local edits", async () => {
    const user = userEvent.setup();
    renderEditor("Rejected candidate");

    const input = screen.getByTestId("entity-prompt-template-editor-input");
    expect(input).toHaveTextContent("Rejected candidate");
    await user.click(input);
    const selection = window.getSelection();
    selection?.selectAllChildren(input);
    selection?.collapseToEnd();
    fireEvent(document, new Event("selectionchange"));
    await user.paste(" revised");
    expect(input).toHaveTextContent("Rejected candidate revised");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while creation is unresolved", async () => {
    mocks.create.mockResolvedValue({ id: "proposal-1" });
    renderEditor();

    fireEvent.click(screen.getByTestId("entity-prompt-template-edit"));
    const button = screen.getByTestId("entity-prompt-template-propose-change");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Explain this change in one sentence",
      }),
      { target: { value: "Improve the project context." } },
    );
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(
        screen.getByTestId("entity-prompt-template-proposal-success"),
      ).toBeInTheDocument(),
    );
  });
  it("inserts a discovered substitution and proposes only its exact validated source", async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ id: "proposal-1" });
    renderEditor();
    await user.click(screen.getByTestId("entity-prompt-template-edit"));
    await user.click(screen.getByRole("textbox", { name: "Template content" }));
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.paste("$");
    expect(
      await screen.findByTestId("template-substitution-suggestions"),
    ).toHaveTextContent("Focal entity identifier.");
    await user.keyboard("{Enter}");
    const save = screen.getByTestId("entity-prompt-template-propose-change");
    expect(save).toBeDisabled();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Explain this change in one sentence",
      }),
      { target: { value: "Improve the project context." } },
    );
    await waitFor(() => expect(save).toBeEnabled());
    expect(mocks.validate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        templateKey: "entity_context",
        entityPromptTemplateDraftValidationRequestDto: {
          selector: template.effective.selector,
          syntaxVersion: "V1",
          content: "{{entity.id}}",
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await user.click(save);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: "{{entity.id}}" }),
    );
    expect(
      screen.getByTestId("entity-prompt-template-current-content"),
    ).toHaveTextContent("Authoritative effective content");
  });

  it("blocks invalid drafts, surfaces validation failures, and retains content when a proposal fails", async () => {
    const user = userEvent.setup();
    mocks.validate.mockResolvedValueOnce({
      data: {
        data: {
          status: "INVALID",
          issues: [
            {
              code: "UNSUPPORTED_INPUT",
              path: "content",
              message: "Unsupported field",
            },
          ],
        },
      },
    });
    renderEditor("{{bad}}");
    expect(
      await screen.findByTestId("template-validation-issue"),
    ).toHaveTextContent("Unsupported field");
    const save = screen.getByTestId("entity-prompt-template-propose-change");
    expect(save).toBeDisabled();
    mocks.validate.mockRejectedValueOnce(new Error("Validation offline"));
    await user.click(screen.getByRole("textbox", { name: "Template content" }));
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.paste("replacement");
    expect(await screen.findByText("Validation offline")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.paste(" corrected");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Explain this change in one sentence",
      }),
      { target: { value: "Improve the project context." } },
    );
    await waitFor(() => expect(save).toBeEnabled());
    mocks.create.mockRejectedValueOnce(new Error("Proposal unavailable"));
    await user.click(save);
    expect(
      await screen.findByTestId("entity-prompt-template-proposal-error"),
    ).toHaveTextContent("Proposal unavailable");
    expect(
      screen.getByRole("textbox", { name: "Template content" }),
    ).toHaveTextContent("replacement corrected");
    expect(save).toBeEnabled();
  });
});
