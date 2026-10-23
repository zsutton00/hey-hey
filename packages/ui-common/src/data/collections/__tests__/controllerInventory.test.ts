import { QueryClient } from "@tanstack/react-query";
import {
  ControllerEnrollmentEligibilityState,
  MachineExecutionReadinessState,
  type ControllerInventoryResponseDto,
} from "../../../api";
import { machinesClient } from "../../../clients/serviceClients";
import {
  controllerInventoryQueryOptions,
  controllerInventoryKeys,
} from "../controllerInventory";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: {
    listMachineControllers: vi.fn(),
  },
}));

const inventory: ControllerInventoryResponseDto = {
  machineId: "machine-1",
  authorizationProtocolVersion: 2,
  enrollmentState: ControllerEnrollmentEligibilityState.Ready,
  executionReadiness: MachineExecutionReadinessState.Ready,
  controllers: [],
};

describe("controller inventory collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the machine identifier to the generated inventory request", async () => {
    vi.mocked(machinesClient.listMachineControllers).mockResolvedValue({
      data: { data: inventory },
    });

    const client = new QueryClient();
    const result = await client.fetchQuery(
      controllerInventoryQueryOptions("machine-1")
    );
    client.clear();

    expect(machinesClient.listMachineControllers).toHaveBeenCalledWith(
      {
        machineId: "machine-1",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual(inventory);
  });

  it("keeps each machine in a distinct single-query cache key", () => {
    expect(controllerInventoryKeys.detail("machine-1")).not.toEqual(
      controllerInventoryKeys.detail("machine-2")
    );
  });
});
