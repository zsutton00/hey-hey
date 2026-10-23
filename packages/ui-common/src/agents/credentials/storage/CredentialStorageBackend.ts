import type {
  AgentAccountId,
  AgentCredentialMetadata,
  AgentCredentialRecord,
  AgentType,
} from "../types";

export interface CredentialStorageBackend {
  readonly kind: "keyring" | "encrypted-file";
  getCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<AgentCredentialRecord | null>;
  storeCredential(credential: AgentCredentialRecord): Promise<void>;
  listCredentials(agentType?: AgentType): Promise<AgentCredentialMetadata[]>;
  deleteCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<boolean>;
  clearAll(): Promise<void>;
}
