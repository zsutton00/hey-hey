import React from "react";
import { useCliRequired } from "./runtime/hooks/useCliRequired";
import type { AgentBridgeRecoveryState } from "./agentBridgeRecoveryState";

export interface RequireCliConnectedRenderProps {
  disabled: boolean;
  recoveryState: AgentBridgeRecoveryState;
}

export interface RequireCliConnectedProps {
  organizationId: string;
  projectId: string;
  conversationId: string;
  children: (props: RequireCliConnectedRenderProps) => React.ReactNode;
}

export function RequireCliConnected({
  organizationId,
  projectId,
  conversationId,
  children,
}: RequireCliConnectedProps): React.ReactElement {
  const result = useCliRequired(organizationId, projectId, conversationId);
  return (
    <>
      {children({
        disabled: result.type !== "ready",
        recoveryState: result,
      })}
    </>
  );
}
