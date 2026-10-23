export interface ApprovalConfig {
  requiresProposal: boolean;
  threshold: number;
}

export interface PermissionRule {
  match: Record<string, unknown>;
  config: ApprovalConfig;
}

export interface EntityContext {
  type: string;
  parentTaskId: string | null;
}
