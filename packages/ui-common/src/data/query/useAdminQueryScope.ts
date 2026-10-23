import { useSyncExternalStore } from "react";
import {
  getBrowserAuthRevision,
  onAuthChange,
} from "../../services/authService";

/** Shared by admin readers; every browser authorization transition rotates it. */
export function useAdminQueryScope(): string {
  const revision = useSyncExternalStore(
    onAuthChange,
    getBrowserAuthRevision,
    getBrowserAuthRevision
  );
  return `browser-auth-${revision}`;
}
