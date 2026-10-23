import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosHeaders } from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import { RequestAccessPage } from "./RequestAccessPage";

vi.mock("@hey-hey/ui-common/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/clients")>()),
  unifiedApiClient: {
    submitPrivateBetaAccessRequest: vi.fn(),
    getPublicPrivateBetaAdmissionMode: vi.fn(),
  },
}));

const submitRequest = vi.mocked(
  unifiedApiClient.submitPrivateBetaAccessRequest,
);
type SubmissionResponse = Awaited<
  ReturnType<typeof unifiedApiClient.submitPrivateBetaAccessRequest>
>;

const acceptedResponse: SubmissionResponse = {
  data: {
    success: true,
    message: "Request processed successfully",
    data: { accepted: true },
    timestamp: "2026-08-11T00:00:00.000Z",
    statusCode: 202,
  },
  status: 202,
  statusText: "Accepted",
  headers: {},
  config: { headers: new AxiosHeaders() },
};

const LocationProbe = () => {
  const location = useLocation();

  return <div data-testid="current-location">{location.pathname}</div>;
};

const renderRequestAccessPage = async () => {
  render(
    <MemoryRouter initialEntries={["/request-access"]}>
      <Routes>
        <Route path="/request-access" element={<RequestAccessPage />} />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId("request-access-form");
};

const fillRequest = async () => {
  const user = userEvent.setup();

  fireEvent.change(screen.getByLabelText(/^Name/), {
    target: { value: "Ada Lovelace" },
  });
  fireEvent.change(screen.getByLabelText(/^Work email/), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/^Organization name/), {
    target: { value: "Analytical Engines" },
  });

  return user;
};

describe("RequestAccessPage", () => {
  it("explains beta capacity review before submission and confirms review in PAUSED mode", async () => {
    vi.mocked(
      unifiedApiClient.getPublicPrivateBetaAdmissionMode,
    ).mockResolvedValue({
      ...acceptedResponse,
      data: { ...acceptedResponse.data, data: { mode: "PAUSED" } },
    });
    submitRequest.mockResolvedValue(acceptedResponse);
    await renderRequestAccessPage();
    expect(
      screen.getByText(/Hey Hey is in beta, and we are currently reviewing new signups/),
    ).toBeInTheDocument();
    const user = await fillRequest();
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(
      await screen.findByText(/Your request is waiting for review/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Existing User Sign In" }),
    ).toHaveAttribute("href", "/login");
  });

  it("offers retry and sign-in when admission mode cannot be read", async () => {
    vi.mocked(
      unifiedApiClient.getPublicPrivateBetaAdmissionMode,
    ).mockRejectedValueOnce(new Error("Unavailable"));
    render(
      <MemoryRouter>
        <RequestAccessPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Signup information could not be loaded",
    );
    expect(screen.queryByTestId("request-access-form")).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByTestId("request-access-form"),
    ).toBeInTheDocument();
  });
  beforeEach(() => {
    submitRequest.mockReset();
    vi.mocked(
      unifiedApiClient.getPublicPrivateBetaAdmissionMode,
    ).mockResolvedValue({
      ...acceptedResponse,
      data: { ...acceptedResponse.data, data: { mode: "OPEN" } },
    });
  });

  it("presents the same three required signup fields and preserves existing sign-in", async () => {
    await renderRequestAccessPage();
    expect(
      screen.getByRole("heading", { name: "Sign up for the beta" }),
    ).toBeInTheDocument();
    for (const label of ["Name", "Work email", "Organization name"]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeRequired();
    }
    expect(screen.queryByLabelText(/Team size/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Hey Hey is still in beta. We use it every day, but you may encounter bugs.",
      ),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Existing User Sign In" }));
    expect(screen.getByTestId("current-location")).toHaveTextContent("/login");
  });

  it("shows required and email errors without submitting", async () => {
    await renderRequestAccessPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(submitRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your work email.")).toBeInTheDocument();
    expect(
      screen.getByText("Enter your organization name."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Work email/), "invalid");
    expect(screen.getByText("Enter a valid work email.")).toBeInTheDocument();
  });

  it("trims the three fields, prevents parallel submission, and confirms durable receipt", async () => {
    let complete!: (response: SubmissionResponse) => void;
    submitRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await renderRequestAccessPage();
    const user = await fillRequest();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: " Ada Lovelace " },
    });
    const button = screen.getByRole("button", { name: "Sign up" });
    await user.click(button);
    fireEvent.submit(screen.getByTestId("request-access-form"));
    expect(button).toBeDisabled();
    expect(submitRequest).toHaveBeenCalledTimes(1);
    expect(submitRequest).toHaveBeenCalledWith({
      privateBetaAccessRequestSubmissionDto: {
        name: "Ada Lovelace",
        workEmail: "ada@example.com",
        organizationName: "Analytical Engines",
      },
    });
    complete(acceptedResponse);
    expect(
      await screen.findByTestId("request-access-confirmation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check your inbox for an activation link/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/review|authorized/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("request-access-form")).not.toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute(
      "id",
      "request-access-confirmation-title",
    );
  });

  it.each([429, 500])(
    "keeps values and supports retry after HTTP %s",
    async (status) => {
      submitRequest
        .mockRejectedValueOnce({ response: { status } })
        .mockResolvedValueOnce(acceptedResponse);
      await renderRequestAccessPage();
      const user = await fillRequest();
      await user.click(screen.getByRole("button", { name: "Sign up" }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByLabelText(/^Work email/)).toHaveValue(
        "ada@example.com",
      );
      fireEvent.change(screen.getByLabelText(/^Organization name/), {
        target: { value: "Updated Engines" },
      });
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(submitRequest).toHaveBeenCalledTimes(2));
      expect(submitRequest.mock.calls[1]?.[0]).toEqual({
        privateBetaAccessRequestSubmissionDto: {
          name: "Ada Lovelace",
          workEmail: "ada@example.com",
          organizationName: "Updated Engines",
        },
      });
      expect(
        await screen.findByTestId("request-access-confirmation"),
      ).toBeInTheDocument();
    },
  );
});
