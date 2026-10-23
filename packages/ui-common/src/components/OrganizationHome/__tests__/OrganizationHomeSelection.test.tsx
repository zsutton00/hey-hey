import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BrowserOrganizationSelectionDto } from "../../../api";
import { OrganizationHomeSelection } from "../OrganizationHomeSelection";

const makeSelection = (
  overrides: Partial<BrowserOrganizationSelectionDto> = {}
): BrowserOrganizationSelectionDto => ({
  status: "selection_required",
  user: {
    id: "user-1",
    email: "alex@example.com",
    name: "Alex",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  organizations: [
    { id: "org-1", name: "Acme" },
    { id: "org-2", name: "Beta" },
  ],
  ...overrides,
});

const renderSelection = (
  selection = makeSelection(),
  overrides: Partial<ComponentProps<typeof OrganizationHomeSelection>> = {}
) => {
  const props = {
    selection,
    pending: false,
    error: null,
    onSelect: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };

  return render(
    <ThemeProvider theme={createTheme()}>
      <OrganizationHomeSelection {...props} />
    </ThemeProvider>
  );
};

describe("OrganizationHomeSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("places organization selection in the full-width Projects panel", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSelection(makeSelection(), { onSelect });
    const card = screen.getByTestId("organization-home-projects-card");
    const picker = screen.getByTestId("organization-home-organization-picker");

    expect(card.parentElement).toHaveClass("MuiContainer-root");
    expect(card).toContainElement(picker);
    expect(
      screen.queryByText("Choose an organization above")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith("org-2");
  });

  it("retains denial, pending, error, and no-access states", () => {
    const { rerender } = renderSelection(
      makeSelection({ status: "selection_denied" }),
      { pending: true, error: "Unable to confirm organization" }
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("denied");
    expect(alerts[1]).toHaveTextContent("Unable to confirm organization");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirming organization"
    );
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    rerender(
      <ThemeProvider theme={createTheme()}>
        <OrganizationHomeSelection
          selection={makeSelection({ organizations: [] })}
          pending={false}
          error={null}
          onSelect={vi.fn()}
          onSignOut={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByText(/No accessible organizations/)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});
