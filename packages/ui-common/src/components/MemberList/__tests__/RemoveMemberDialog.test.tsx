import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RemoveMemberDialog } from "../RemoveMemberDialog";

describe("RemoveMemberDialog", () => {
  it("renders project-scope copy when scope is project", () => {
    render(
      <RemoveMemberDialog
        open
        scope="project"
        memberName="Alex Doe"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("remove-member-dialog-project")
    ).toBeInTheDocument();
    expect(screen.getByTestId("remove-member-dialog-body")).toHaveTextContent(
      /Remove Alex Doe from this project/
    );
    expect(
      screen.getByTestId("remove-member-dialog-confirm")
    ).toHaveTextContent("Remove from project");
  });

  it("renders organization-scope copy when scope is organization", () => {
    render(
      <RemoveMemberDialog
        open
        scope="organization"
        memberName="Alex Doe"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("remove-member-dialog-organization")
    ).toBeInTheDocument();
    expect(screen.getByTestId("remove-member-dialog-body")).toHaveTextContent(
      /Remove Alex Doe from this organization/
    );
    expect(
      screen.getByTestId("remove-member-dialog-confirm")
    ).toHaveTextContent("Remove from organization");
  });

  it("calls onConfirm when the destructive button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveMemberDialog
        open
        scope="project"
        memberName="Alex"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByTestId("remove-member-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onClose when the cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <RemoveMemberDialog
        open
        scope="project"
        memberName="Alex"
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("remove-member-dialog-cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables both buttons while loading", () => {
    render(
      <RemoveMemberDialog
        open
        loading
        scope="project"
        memberName="Alex"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByTestId("remove-member-dialog-confirm")).toBeDisabled();
    expect(screen.getByTestId("remove-member-dialog-cancel")).toBeDisabled();
  });

  it("renders a last-owner error with warning severity", () => {
    render(
      <RemoveMemberDialog
        open
        scope="organization"
        memberName="Alex"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        error={{
          kind: "lastOwner",
          message: "Cannot remove the last owner of an organization",
        }}
      />
    );

    const alert = screen.getByTestId("remove-member-dialog-error");
    expect(alert).toHaveTextContent(/last owner/);
  });
});
