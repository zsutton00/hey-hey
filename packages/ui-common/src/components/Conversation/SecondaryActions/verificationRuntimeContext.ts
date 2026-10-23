import { createContext } from "react";
import type { AgentSessionDto } from "../../../api";

export interface VerificationRuntimeContextValue {
  /** The session whose work raised the suggestion; Verify Feature reads it. */
  parentAgentSessionId: string | null;
  machineId: string | null;
  serviceIds: string[];
  launchServiceId: string | null;
  serviceName?: string | null;
}

export const VerificationRuntimeContext =
  createContext<VerificationRuntimeContextValue | null>(null);

export const resolveVerificationRuntimeContext = (
  runtime: VerificationRuntimeContextValue | null,
  source:
    | Pick<
        AgentSessionDto,
        "id" | "machineId" | "serviceIds" | "launchServiceId" | "service"
      >
    | null
    | undefined,
): VerificationRuntimeContextValue => ({
  parentAgentSessionId: runtime?.parentAgentSessionId ?? source?.id ?? null,
  machineId: runtime?.machineId ?? source?.machineId ?? null,
  serviceIds: runtime?.serviceIds ?? source?.serviceIds ?? [],
  launchServiceId: runtime?.launchServiceId ?? source?.launchServiceId ?? null,
  serviceName: runtime?.serviceName ?? source?.service?.name ?? null,
});
