import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InviteByEmailDialog } from "../InviteByEmailDialog";
import { ProjectRole } from "../../../api";

describe("InviteByEmailDialog", () => {
  it("shows the email + role fields and the submit button", () => {
    render(<InviteByEmailDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByTestId("invite-by-email-email")).toBeInTheDocument();
    expect(screen.getByTestId("invite-by-email-role")).toBeInTheDocument();
    expect(screen.getByTestId("invite-by-email-submit")).toBeInTheDocument();
  });

  it("rejects blank email and does not submit", () => {
    const onSubmit = vi.fn();
    render(<InviteByEmailDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

    // Dialog opens with the submit button disabled when email is empty;
    // type a value, clear it, then submit via keyboard to hit the validator.
    const emailInput = screen.getByTestId("invite-by-email-email");
    fireEvent.change(emailInput, { target: { value: "x" } });
    fireEvent.change(emailInput, { target: { value: "" } });

    const submit = screen.getByTestId("invite-by-email-submit");
    expect(submit).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects malformed email and does not submit", () => {
    const onSubmit = vi.fn();
    render(<InviteByEmailDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("invite-by-email-email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByTestId("invite-by-email-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("submits trimmed email with the default Member role", () => {
    const onSubmit = vi.fn();
    render(<InviteByEmailDialog open onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("invite-by-email-email"), {
      target: { value: "  new@example.com  " },
    });
    fireEvent.click(screen.getByTestId("invite-by-email-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      "new@example.com",
      ProjectRole.Member
    );
  });

  it("disables inputs while loading and renders a progress indicator", () => {
    render(
      <InviteByEmailDialog open loading onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    const submit = screen.getByTestId("invite-by-email-submit");
    expect(submit).toBeDisabled();
    expect(screen.getByText("Sending invite…")).toBeInTheDocument();
    expect(screen.getByTestId("invite-by-email-email")).toBeDisabled();
  });

  it("renders the duplicate-email hint pointing to the Add existing user flow", () => {
    render(
      <InviteByEmailDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={{ kind: "duplicate" }}
      />
    );

    const alert = screen.getByTestId("invite-by-email-duplicate");
    expect(alert).toHaveTextContent(/already belongs to this organization/i);
    expect(alert).toHaveTextContent(/Add existing user/);
  });

  it("renders a generic error when the server fails for another reason", () => {
    render(
      <InviteByEmailDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        error={{ kind: "generic", message: "Something went wrong" }}
      />
    );

    expect(screen.getByTestId("invite-by-email-error")).toHaveTextContent(
      "Something went wrong"
    );
  });

  it("resets fields when reopened", () => {
    const { rerender } = render(
      <InviteByEmailDialog open onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    const input = screen.getByTestId(
      "invite-by-email-email"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed@example.com" } });
    expect(input.value).toBe("typed@example.com");

    rerender(
      <InviteByEmailDialog open={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    rerender(<InviteByEmailDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);

    const reopened = screen.getByTestId(
      "invite-by-email-email"
    ) as HTMLInputElement;
    expect(reopened.value).toBe("");
  });
});
