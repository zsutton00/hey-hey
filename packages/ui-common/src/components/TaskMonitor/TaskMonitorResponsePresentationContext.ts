import { createContext } from "react";

/** A successful owner command may redock its workspace; it never changes execution state. */
export const TaskMonitorResponsePresentationContext = createContext<
  ((monitorId: string) => void) | null
>(null);
