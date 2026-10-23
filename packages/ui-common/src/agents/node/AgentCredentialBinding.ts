import type {
  AgentAccountId,
  CredentialLifecycleMetadata,
  CredentialManager,
  CredentialManagerEvent,
} from "../credentials";

export interface AgentCredentialBinding {
  manager: CredentialManager;
  accountId: AgentAccountId | string;
  refreshIfExpiringWithinMs?: number;
  environmentOverrides?: Record<string, string>;
  onCredentialEvent?: (event: CredentialManagerEvent) => void;
}

export interface CredentialAwareNodeAdapter {
  getCredentialLifecycleMetadata(): CredentialLifecycleMetadata | null;
}

export interface CredentialRefreshCapableNodeAdapter
  extends CredentialAwareNodeAdapter {
  refreshCredential(): Promise<void>;
}

export const isCredentialAwareNodeAdapter = (
  value: unknown
): value is CredentialAwareNodeAdapter => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CredentialAwareNodeAdapter>;
  return typeof candidate.getCredentialLifecycleMetadata === "function";
};

export const isCredentialRefreshCapableNodeAdapter = (
  value: unknown
): value is CredentialRefreshCapableNodeAdapter => {
  if (!isCredentialAwareNodeAdapter(value)) {
    return false;
  }

  const candidate = value as Partial<CredentialRefreshCapableNodeAdapter>;
  return typeof candidate.refreshCredential === "function";
};
