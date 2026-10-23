import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDocumentContent } from "../CreateDocumentContent";

const {
  createAdrMock,
  createDesignDocMock,
  generateSuggestedDesignDocMock,
} = vi.hoisted(() => ({
  createAdrMock: vi.fn(),
  createDesignDocMock: vi.fn(),
  generateSuggestedDesignDocMock: vi.fn(),
}));

vi.mock("../../../data/hooks", () => ({
  useCreateAdr: () => ({
    mutate: createAdrMock,
    isPending: false,
  }),
  useCreateDesignDoc: () => ({
    mutate: createDesignDocMock,
    isPending: false,
  }),
  useGenerateSuggestedDesignDoc: () => ({
    mutate: generateSuggestedDesignDocMock,
    isPending: false,
  }),
}));

vi.mock("../../../hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "fallback-org" }),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    createDesignDocLinks: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const renderBlankDocument = (props: {
  parentEntityId?: string | null;
  parentEntityType?: "TASK" | "DESIGN_DOC" | null;
} = {}) =>
  render(
    <CreateDocumentContent
      mode="blank_doc"
      organizationId="org-1"
      projectId="project-1"
      onClose={vi.fn()}
      {...props}
    />
  );

describe("CreateDocumentContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes TASK parent fields when creating an ADR", async () => {
    const user = userEvent.setup();
    renderBlankDocument({
      parentEntityId: "task-1",
      parentEntityType: "TASK",
    });

    await user.click(screen.getByText("Architecture Decision Record"));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Use PostgreSQL");
    await user.click(screen.getByRole("button", { name: "Ready" }));

    expect(createAdrMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      adr: expect.objectContaining({
        name: "Use PostgreSQL",
        projectId: "project-1",
        parentEntityId: "task-1",
        parentEntityType: "TASK",
      }),
    });
  });

  it("includes DESIGN_DOC parent fields when creating a standard document", async () => {
    const user = userEvent.setup();
    renderBlankDocument({
      parentEntityId: "design-doc-1",
      parentEntityType: "DESIGN_DOC",
    });

    await user.click(screen.getByText("Brainstorm"));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Explore options");
    await user.click(screen.getByRole("button", { name: "Ready" }));

    expect(createDesignDocMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      designDoc: expect.objectContaining({
        name: "Explore options",
        projectId: "project-1",
        parentEntityId: "design-doc-1",
        parentEntityType: "DESIGN_DOC",
        template: "BRAINSTORM",
      }),
    });
  });

  it("keeps blank project or plan creation unparented", async () => {
    const user = userEvent.setup();
    renderBlankDocument();

    await user.click(screen.getByText("Brainstorm"));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Project notes");
    await user.click(screen.getByRole("button", { name: "Ready" }));

    expect(createDesignDocMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      designDoc: expect.objectContaining({
        parentEntityId: undefined,
        parentEntityType: undefined,
      }),
    });
  });
});
