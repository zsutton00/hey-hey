import type {
  AgentAccountId,
  CredentialLifecycleMetadata,
  CredentialManager,
  CredentialManagerEvent,
} from '../credentials/index';

export interface AgentCredentialBinding {
  manager: CredentialManager;
  accountId: AgentAccountId | string;
  refreshIfExpiringWithinMs?: number | undefined;
  environmentOverrides?: Record<string, string> | undefined;
  onCredentialEvent?: ((event: CredentialManagerEvent) => void) | undefined;
}

export interface CredentialAwareNodeAdapter {
  getCredentialLifecycleMetadata(): CredentialLifecycleMetadata | null;
}

export interface CredentialRefreshCapableNodeAdapter extends CredentialAwareNodeAdapter {
  refreshCredential(): Promise<void>;
}

export const isCredentialAwareNodeAdapter = (
  value: unknown,
): value is CredentialAwareNodeAdapter => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CredentialAwareNodeAdapter>;
  return typeof candidate.getCredentialLifecycleMetadata === 'function';
};

export const isCredentialRefreshCapableNodeAdapter = (
  value: unknown,
): value is CredentialRefreshCapableNodeAdapter => {
  if (!isCredentialAwareNodeAdapter(value)) {
    return false;
  }

  const candidate = value as Partial<CredentialRefreshCapableNodeAdapter>;
  return typeof candidate.refreshCredential === 'function';
};
