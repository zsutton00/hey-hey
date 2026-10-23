import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSessionLaunchButton } from "./ServiceSessionLaunchButton";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  useEntityConversationLauncher: () => ({
    launch: mocks.launch,
    clearError: mocks.clearError,
    error: null,
    isLoading: false,
  }),
  DiscussModal: ({
    onSubmit,
    fixedServiceScope,
  }: {
    onSubmit: (submission: {
      prompt: string;
      provider: "claude";
      machineId: string;
    }) => void;
    fixedServiceScope: { serviceId: string; serviceName: string };
  }) => (
    <div data-testid="service-session-modal">
      <span>{fixedServiceScope.serviceName}</span>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            prompt: "Inspect this Service",
            provider: "claude",
            machineId: "machine-1",
          })
        }
      >
        Submit
      </button>
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/api", () => ({
  EntityType: { Service: "SERVICE" },
}));

describe("ServiceSessionLaunchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.launch.mockResolvedValue(true);
  });

  it("opens a visible fixed-Service launcher without an Action Capsule", async () => {
    render(
      <ServiceSessionLaunchButton
        organizationId="organization-1"
        projectId="project-1"
        serviceId="service-1"
        serviceName="UI"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Start Service Session" })
    );
    expect(screen.getByTestId("service-session-modal")).toHaveTextContent("UI");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mocks.launch).toHaveBeenCalledWith({
        prompt: "Inspect this Service",
        provider: "claude",
        machineId: "machine-1",
        serviceId: "service-1",
        context: {
          entityId: "service-1",
          entityType: "SERVICE",
          entityTitle: "UI",
        },
      });
      expect(screen.queryByTestId("service-session-modal")).not.toBeInTheDocument();
    });
  });
});
