import {
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../../api";

export interface MachineExecutionReadiness {
  state: MachineDto["executionReadiness"];
  label: string;
  reason: string;
  selectable: boolean;
}

const readinessByState: Record<
  MachineDto["executionReadiness"],
  Omit<MachineExecutionReadiness, "state">
> = {
  [MachineExecutionReadinessState.NoMachineSelected]: {
    label: "No machine selected",
    reason: "Select a ready machine to continue.",
    selectable: false,
  },
  [MachineExecutionReadinessState.LegacyProtocol]: {
    label: "Legacy protocol",
    reason:
      "Update the CLI and begin controller enrollment locally on this machine.",
    selectable: false,
  },
  [MachineExecutionReadinessState.ControllerEnrollmentRequired]: {
    label: "Enrollment required",
    reason:
      "Begin controller enrollment locally from this machine before running local work.",
    selectable: false,
  },
  [MachineExecutionReadinessState.ControllerRevoked]: {
    label: "Controller revoked",
    reason:
      "Controller authority was revoked. Begin controller enrollment again from this machine.",
    selectable: false,
  },
  [MachineExecutionReadinessState.MachineRevoked]: {
    label: "Revoked",
    reason: "This machine was revoked and cannot run local work.",
    selectable: false,
  },
  [MachineExecutionReadinessState.Disconnected]: {
    label: "Disconnected",
    reason: "Start the CLI on this machine and wait for it to connect.",
    selectable: false,
  },
  [MachineExecutionReadinessState.Ready]: {
    label: "Ready",
    reason: "Connected and authorized for local work.",
    selectable: true,
  },
};

export const getMachineExecutionReadinessPresentation = (
  state: MachineDto["executionReadiness"]
): MachineExecutionReadiness => ({
  state,
  ...readinessByState[state],
});

export const classifyMachineExecutionReadiness = (
  machine: MachineDto
): MachineExecutionReadiness => {
  const globalReadiness = getMachineExecutionReadinessPresentation(
    machine.executionReadiness
  );
  if (!globalReadiness.selectable) return globalReadiness;

  switch (machine.currentControllerEligibility) {
    case null:
      return {
        state: machine.executionReadiness,
        label: "Controller context unavailable",
        reason:
          "Refresh this page to restore controller context before selecting the machine.",
        selectable: false,
      };
    case CurrentControllerMachineEligibilityState.Eligible:
      return globalReadiness;
    case CurrentControllerMachineEligibilityState.NotEnrolled:
      return {
        state: machine.executionReadiness,
        label: "Authorize this browser",
        reason: "This browser is not authorized for this Agent Bridge.",
        selectable: false,
      };
    case CurrentControllerMachineEligibilityState.Revoked:
      return {
        state: machine.executionReadiness,
        label: "Browser authorization revoked",
        reason: "Authorize this browser again from the target Agent Bridge.",
        selectable: false,
      };
  }
};

export const isMachineExecutionReady = (machine: MachineDto): boolean =>
  classifyMachineExecutionReadiness(machine).selectable;

export const getMachineExecutionLabel = (machine: MachineDto): string => {
  const readiness = classifyMachineExecutionReadiness(machine);
  return `${machine.name} — ${readiness.label}`;
};
