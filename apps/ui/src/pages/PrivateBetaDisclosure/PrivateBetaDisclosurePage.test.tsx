import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE_REQUIREMENTS } from "../Legal/legalContent";
import { PrivateBetaDisclosurePage } from "./PrivateBetaDisclosurePage";

const usePrivateBetaDisclosureMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  usePrivateBetaDisclosure: () => usePrivateBetaDisclosureMock(),
}));

const makeStatus = (recordedAcceptances = [], isComplete = false) => ({
  data: {
    requiredDocuments: DISCLOSURE_REQUIREMENTS.map((requirement) => ({
      documentKind: requirement.documentKey.toUpperCase() as
        | "TERMS"
        | "PRIVACY"
        | "SECURITY",
      version: requirement.version,
      effectiveDate: requirement.effectiveDate,
      actionType: requirement.actionType,
    })),
    recordedAcceptances,
    isComplete,
  },
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue({
    requiredDocuments: DISCLOSURE_REQUIREMENTS.map((requirement) => ({
      documentKind: requirement.documentKey.toUpperCase(),
      version: requirement.version,
      effectiveDate: requirement.effectiveDate,
      actionType: requirement.actionType,
    })),
    recordedAcceptances: [],
    isComplete: false,
  }),
  markStale: vi.fn(),
  submitAcceptance: vi.fn().mockResolvedValue({ accepted: true }),
});

const renderPage = (initialEntry = "/private-beta/disclosure") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/private-beta/disclosure"
          element={<PrivateBetaDisclosurePage />}
        />
        <Route path="/home" element={<div data-testid="home">Home</div>} />
        <Route
          path="/projects/project-1"
          element={<div data-testid="returned-destination">Project</div>}
        />
      </Routes>
    </MemoryRouter>
  );

describe("PrivateBetaDisclosurePage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only the current Terms with one agreement checkpoint", () => {
    usePrivateBetaDisclosureMock.mockReturnValue(makeStatus());

    renderPage();

    expect(
      screen.getByRole("heading", { name: /before you enter/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Terms of Service/i)).toBeInTheDocument();
    expect(screen.queryByText(/Privacy Policy/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Agent Bridge Security Boundary/i)
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      screen.getByLabelText(
        /agree to the current terms/i
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Version 1\.2-beta/)).toHaveLength(1);
  });

  it("submits distinct current actions and returns to the original destination", async () => {
    const user = userEvent.setup();
    const submitAcceptance = vi.fn().mockResolvedValue({ accepted: true });
    const refetch = vi.fn().mockResolvedValue({
      ...makeStatus([], true).data,
      recordedAcceptances: [
        {
          documentKind: "TERMS",
          version: "1.2-beta",
          effectiveDate: "2026-09-14",
          actionType: "AGREED",
        },
      ],
      isComplete: true,
    });
    usePrivateBetaDisclosureMock.mockReturnValue({
      ...makeStatus(),
      submitAcceptance,
      refetch,
    });

    renderPage("/private-beta/disclosure?returnTo=%2Fprojects%2Fproject-1");

    await user.click(
      screen.getByLabelText(/agree to the current terms/i)
    );
    await user.click(
      screen.getByRole("button", { name: /continue to hey hey/i })
    );

    expect(submitAcceptance).toHaveBeenCalledTimes(1);
    expect(submitAcceptance).toHaveBeenNthCalledWith(1, {
      documentKind: "TERMS",
      version: "1.2-beta",
      effectiveDate: "2026-09-14",
      actionType: "AGREED",
    });
    expect(refetch).toHaveBeenCalledOnce();
    expect(
      await screen.findByTestId("returned-destination")
    ).toBeInTheDocument();
  });

  it("requires the single agreement checkpoint before submitting", async () => {
    const user = userEvent.setup();
    const submitAcceptance = vi.fn().mockResolvedValue({ accepted: true });
    usePrivateBetaDisclosureMock.mockReturnValue({
      ...makeStatus(),
      submitAcceptance,
    });

    renderPage();

    await user.click(
      screen.getByRole("button", { name: /continue to hey hey/i })
    );

    expect(
      await screen.findByText(
        /please agree to the current terms/i
      )
    ).toBeInTheDocument();
    expect(submitAcceptance).not.toHaveBeenCalled();
  });
});
