import type { ReactNode } from "react";
import { getDeployment } from "../../services/runtimeConfig";

export interface LocalProps {
  children: ReactNode;
}

/** Shows its children only in a local deployment; renders nothing otherwise. */
export function Local({ children }: LocalProps) {
  return getDeployment() === "local" ? <>{children}</> : null;
}
