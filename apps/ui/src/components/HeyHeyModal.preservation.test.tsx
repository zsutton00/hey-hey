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
  AdvancedSearch: ({ onSelect }: { onSelect: (value: []) => void }) => (
    <>
      <input aria-label="Search draft" />
      <button onClick={() => onSelect([])}>Select results</button>
    </>
  ),
}));
vi.mock("@hey-hey/ui-common/components/DesignDoc", () => ({
  CreateDocumentContent: () => <input aria-label="Document draft" />,
}));
const selected = vi.fn();
function Openers() {
  const modal = useModal();
  return (
    <>
      <button
        onClick={() =>
          modal?.openModal({
            type: ModalType.ADVANCED_SEARCH,
            organizationId: "org",
            projectId: "project",
            onSelect: selected,
          })
        }
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
    </>
  );
}
describe("legacy shared-host eligibility", () => {
  it("keeps callback actions working without offering Minimize", async () => {
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
    await user.click(screen.getByText("Search"));
    await user.type(screen.getByLabelText("Search draft"), "Search values");
    expect(screen.queryByTestId("modal-minimize")).not.toBeInTheDocument();
    await user.click(screen.getByText("Select results"));
    expect(selected).toHaveBeenCalledWith([]);
    await user.click(screen.getByTestId("modal-close"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByText("Create document"));
    expect(screen.getByLabelText("Document draft")).toBeVisible();
    expect(screen.queryByTestId("modal-minimize")).not.toBeInTheDocument();
  });
});
