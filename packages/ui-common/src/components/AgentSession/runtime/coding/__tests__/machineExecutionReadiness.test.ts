import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../../../api";
import {
  classifyMachineExecutionReadiness,
  getMachineExecutionLabel,
} from "../machineExecutionReadiness";

const machine = (
  executionReadiness: MachineDto["executionReadiness"],
  currentControllerEligibility: MachineDto["currentControllerEligibility"] = CurrentControllerMachineEligibilityState.Eligible
): MachineDto => ({
  machineId: "machine-1",
  name: "Studio Mac",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion:
    executionReadiness === MachineExecutionReadinessState.LegacyProtocol
      ? AuthorizationProtocolVersion.NUMBER_1
      : AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility,
  bindings: [],
});

describe("machine execution readiness", () => {
  it.each([
    [MachineExecutionReadinessState.NoMachineSelected, "No machine selected"],
    [MachineExecutionReadinessState.LegacyProtocol, "Legacy protocol"],
    [
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
      "Enrollment required",
    ],
    [MachineExecutionReadinessState.ControllerRevoked, "Controller revoked"],
    [MachineExecutionReadinessState.MachineRevoked, "Revoked"],
    [MachineExecutionReadinessState.Disconnected, "Disconnected"],
  ] as const)("classifies %s as ineligible", (state, label) => {
    expect(classifyMachineExecutionReadiness(machine(state))).toMatchObject({
      state,
      label,
      selectable: false,
    });
  });

  it("classifies only READY as selectable", () => {
    const ready = machine(MachineExecutionReadinessState.Ready);

    expect(classifyMachineExecutionReadiness(ready)).toEqual({
      state: MachineExecutionReadinessState.Ready,
      label: "Ready",
      reason: "Connected and authorized for local work.",
      selectable: true,
    });
    expect(getMachineExecutionLabel(ready)).toBe("Studio Mac — Ready");
  });

  it("does not use browser-local CLI identity to classify a ready machine", () => {
    const ready = machine(MachineExecutionReadinessState.Ready);

    expect(classifyMachineExecutionReadiness(ready).selectable).toBe(true);
  });

  it("fails closed when no browser controller context was projected", () => {
    expect(
      classifyMachineExecutionReadiness(
        machine(MachineExecutionReadinessState.Ready, null)
      )
    ).toEqual({
      state: MachineExecutionReadinessState.Ready,
      label: "Controller context unavailable",
      reason:
        "Refresh this page to restore controller context before selecting the machine.",
      selectable: false,
    });
  });

  it.each([
    [
      CurrentControllerMachineEligibilityState.NotEnrolled,
      "Authorize this browser",
    ],
    [
      CurrentControllerMachineEligibilityState.Revoked,
      "Browser authorization revoked",
    ],
  ] as const)(
    "keeps a globally ready machine visible but disables %s controller eligibility",
    (eligibility, label) => {
      expect(
        classifyMachineExecutionReadiness(
          machine(MachineExecutionReadinessState.Ready, eligibility)
        )
      ).toMatchObject({ label, selectable: false });
    }
  );
});
