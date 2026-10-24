import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImplementationHintDto } from "@hey-hey/ui-common/api";
import { ServiceImplementationHintsTab } from "./ServiceImplementationHintsTab";

const useHints = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/data", () => ({
  useImplementationHints: useHints,
}));

const hint: ImplementationHintDto = {
  id: "hint",
  serviceId: "legacy",
  agentSessionId: "session",
  featureName: "Legacy knowledge",
  description: "Short summary",
  sourceType: "USER",
  hint: `${"Full implementation knowledge. ".repeat(30)}Final sentence.`,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("ServiceImplementationHintsTab", () => {
  beforeEach(() => {
    useHints.mockReturnValue({ hints: [hint], isLoading: false, error: null });
  });

  it("renders complete legacy text and scopes each Service navigation", () => {
    const { rerender } = render(
      <ServiceImplementationHintsTab organizationId="org" serviceId="legacy" />,
    );
    expect(screen.getByText(hint.hint!)).toBeInTheDocument();
    expect(useHints).toHaveBeenLastCalledWith("org", "legacy", {
      enabled: true,
    });
    useHints.mockReturnValue({ hints: [], isLoading: false, error: null });
    rerender(
      <ServiceImplementationHintsTab
        organizationId="org"
        serviceId="current"
      />,
    );
    expect(useHints).toHaveBeenLastCalledWith("org", "current", {
      enabled: true,
    });
    expect(screen.queryByText(hint.hint!)).not.toBeInTheDocument();
    expect(
      screen.getByText("No implementation hints available yet."),
    ).toBeInTheDocument();
  });

  it("shows loading and errors without presenting partial data as complete", () => {
    useHints.mockReturnValue({ hints: [hint], isLoading: true, error: null });
    const { rerender } = render(
      <ServiceImplementationHintsTab organizationId="org" serviceId="legacy" />,
    );
    expect(
      screen.getByLabelText("Loading implementation hints"),
    ).toBeInTheDocument();
    expect(screen.queryByText(hint.hint!)).not.toBeInTheDocument();
    useHints.mockReturnValue({
      hints: [hint],
      isLoading: false,
      error: "Read failed",
    });
    rerender(
      <ServiceImplementationHintsTab organizationId="org" serviceId="legacy" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Read failed");
    expect(screen.queryByText(hint.hint!)).not.toBeInTheDocument();
  });
});
