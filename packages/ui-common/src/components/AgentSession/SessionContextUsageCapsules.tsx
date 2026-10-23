import type { ComponentProps } from "react";
import { RunContextUsageCapsules } from "./RunContextUsageCapsules";
import { useRunContextUsage } from "./runtime/hooks/useRunContextUsage";

/** Page-owned recovery; the capsule itself only presents readings. */
export function SessionContextUsageCapsules({
  providerSessionId,
  ...props
}: ComponentProps<typeof RunContextUsageCapsules> & {
  providerSessionId: string | undefined;
}) {
  const read = useRunContextUsage({
    organizationId: props.organizationId,
    projectId: props.projectId,
    agentSessionId: props.agentSessionId,
    runId: props.runId,
    providerSessionId,
    enabled:
      props.contextTokens === undefined && providerSessionId !== undefined,
  });
  const recovered =
    read.status === "success" ? read.data?.contextData : undefined;
  const contextTokens = props.contextTokens ?? recovered?.totalTokens;
  const contextWindowTokens =
    props.contextTokens !== undefined
      ? props.contextWindowTokens
      : recovered && recovered.maxTokens > 0
        ? recovered.maxTokens
        : undefined;

  return (
    <RunContextUsageCapsules
      {...props}
      contextTokens={contextTokens}
      contextWindowTokens={contextWindowTokens}
      contextReadState={
        contextTokens !== undefined
          ? { status: "ready" }
          : read.error
            ? { status: "error", message: read.error }
            : { status: "loading" }
      }
    />
  );
}
