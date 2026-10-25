import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalProvider, ModalType, useModal } from "@hey-hey/ui-common/context";
import { ModalRestoreControls } from "@hey-hey/ui-common/components/Modals";
import { HeyHeyModal } from "./HeyHeyModal";

vi.mock("@hey-hey/ui-common/hooks", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/hooks")>()),
  useUserIdentity: () => ({ currentOrgId: "org" }),
}));
vi.mock("../hooks", () => ({ useActiveProjectId: () => "project" }));
vi.mock("@hey-hey/ui-common/components/AdvancedSearch", () => ({
  AdvancedSearch: () => <input aria-label="Search draft" defaultValue="" />,
}));
vi.mock("@hey-hey/ui-common/components/DesignDoc", () => ({
  CreateDocumentContent: () => (
    <input aria-label="Document draft" defaultValue="" />
  ),
}));

function Openers() {
  const modal = useModal();
  const [searchRequests, setSearchRequests] = useState(0);
  return (
    <>
      <button
        onClick={() => {
          setSearchRequests((count) => count + 1);
          modal?.openModal({
            type: ModalType.ADVANCED_SEARCH,
            organizationId: "org",
            projectId: "project",
            onSelect: () => {},
          });
        }}
      >
        Search
      </button>
      <button
        onClick={() =>
          modal?.openModal({
            type: ModalType.CREATE_DOCUMENT,
            mode: "blank_doc",
            organizationId: "org",
            projectId: "project",
          })
        }
      >
        Create document
      </button>
      <output data-testid="search-requests">{searchRequests}</output>
    </>
  );
}

describe("dispatcher preservation", () => {
  it("retains search and creation work independently and reopens an existing configuration without resetting it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ModalProvider>
          <Openers />
          <HeyHeyModal />
          <ModalRestoreControls />
        </ModalProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    const search = screen.getByLabelText("Search draft");
    await user.type(search, "Find the review");
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByRole("button", { name: "Create document" }));
    const document = screen.getByLabelText("Document draft");
    await user.type(document, "New design decisions");
    await user.click(screen.getAllByTestId("modal-minimize")[1]);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(search).toBeVisible());
    expect(screen.getAllByLabelText("Search draft")).toHaveLength(1);
    expect(search).toHaveValue("Find the review");
    expect(document).toHaveValue("New design decisions");
    await user.click(screen.getAllByTestId("modal-close")[0]);
    await user.click(
      screen.getByRole("button", { name: "Restore Create Document" }),
    );
    await waitFor(() => expect(document).toBeVisible());
    expect(screen.getByLabelText("Document draft")).toBe(document);
    expect(document).toHaveValue("New design decisions");
  });
});
