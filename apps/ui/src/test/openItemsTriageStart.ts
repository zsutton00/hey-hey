import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import {
  AuthorizationProtocolVersion,
  ConversationStartRunRequestDtoProviderEnum as Provider,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/contracts/api";
import {
  setCapabilityCatalogForTests,
  type CapabilityCatalogRow,
} from "@hey-hey/ui-common/components";

export const triageMachine: MachineDto = {
  machineId: "triage-machine",
  name: "Local computer",
  pairedAt: "2026-11-01T00:00:00Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerCredentialId: null,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
};

/** Shaped like a CLI's report: several providers, one of them with no models. */
export const triageCatalog: readonly CapabilityCatalogRow[] = [
  {
    provider: Provider.Claude,
    models: [
      {
        id: "claude-opus-5-5",
        label: "Opus 5.5",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        serviceTiers: ["priority"],
      },
      {
        id: "claude-haiku-5-5",
        label: "Haiku 5.5",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
    ],
  },
  {
    provider: Provider.Codex,
    models: [
      {
        id: "gpt-6-sol",
        label: "GPT-6 Sol",
        efforts: ["low", "medium", "high", "xhigh"],
        serviceTiers: ["priority"],
      },
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        serviceTiers: ["priority"],
      },
    ],
  },
  {
    provider: Provider.Opencode,
    models: [
      { id: "opencode-default", label: "OpenCode default", efforts: [] },
    ],
  },
  {
    provider: Provider.Antigravity,
    models: [],
    notice: "Sign in to Antigravity to see its models.",
  },
];

/** Answers the platform's machine list with `machines`. */
export const serveTriageMachines = (machines: MachineDto[]) => {
  globalThis.mswServer.use(
    http.get("*/api/v1/machines", () =>
      HttpResponse.json({ data: { machines } }),
    ),
  );
};

/**
 * One ready machine with a loaded catalog, so the triage start screen can be
 * completed. Call before each test; the render needs a query client.
 */
export const installReadyTriageRuntime = () => {
  localStorage.clear();
  serveTriageMachines([triageMachine]);
  setCapabilityCatalogForTests(triageCatalog);
};

/** Presses a mode button once the machine and model are chosen. */
export const pressTriageStart = async (
  user: Pick<UserEvent, "click">,
  testId: "triage-start-tidy-up" | "triage-start-spring-cleaning",
) => {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeEnabled());
  await user.click(screen.getByTestId(testId));
};
