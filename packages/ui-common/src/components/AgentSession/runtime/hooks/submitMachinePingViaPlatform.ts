import { machinesClient } from "../../../../clients/serviceClients";

export type MachinePingResult =
  | { ok: true; acknowledged: boolean }
  | { ok: false; error: string };

export const submitMachinePingViaPlatform = async (
  machineId: string
): Promise<MachinePingResult> => {
  try {
    const response = await machinesClient.pingMachine({ machineId: machineId });
    const acknowledged = response.data.data?.acknowledged;
    if (acknowledged === undefined) {
      return {
        ok: false,
        error: "Machine ping response did not include an acknowledgement.",
      };
    }
    return { ok: true, acknowledged };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Machine ping failed.";
    return { ok: false, error: message };
  }
};
