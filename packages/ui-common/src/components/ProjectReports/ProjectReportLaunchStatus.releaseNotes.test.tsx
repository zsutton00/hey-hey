import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectReportMachineSection } from "./ProjectReportLaunchStatus";

vi.mock("../AgentSession/MachinePicker", () => ({
  MachinePicker: () => <div data-testid="machine-picker" />,
}));
vi.mock("../AgentSession/AgentBridgeRecoveryNotice", () => ({
  AgentBridgeRecoveryNotice: ({ testId }: { testId: string }) => (
    <div data-testid={testId} />
  ),
}));

const section = (isReady = true) =>
  render(
    <ProjectReportMachineSection
      isReady={isReady}
      mode="zero"
      machines={[]}
      selectedMachine={null}
      recoveryState={{} as never}
      disabled={false}
      onSelectMachine={() => undefined}
    />,
  );

describe("ProjectReportMachineSection release notes", () => {
  it("keeps the CLI recovery path for release notes without requiring every repository", () => {
    section();
    expect(
      screen.getByTestId("project-report-machine-recovery"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();
  });

  it("waits for machine inventory before reporting availability", () => {
    section(false);
    expect(
      screen.queryByTestId("project-report-release-notes-unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("project-report-machine-loading"),
    ).toBeInTheDocument();
  });
});
