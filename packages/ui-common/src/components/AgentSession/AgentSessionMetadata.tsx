import { MetadataDisclosure } from "../shared/MetadataDisclosure";
import type { MetadataDisclosureRow } from "../shared/MetadataDisclosure";
import type { AgentProvider, ReasoningEffort } from "./runtime/types";

export type AgentSessionMetadataPlacement =
  | "below-composer"
  | "below-conversation";

export interface AgentSessionMetadataValues {
  provider: AgentProvider;
  model: string;
  effort?: ReasoningEffort;
  fastMode?: boolean;
  worktree?: string;
  serviceNames?: readonly string[];
}

export interface AgentSessionMetadataProps extends AgentSessionMetadataValues {
  placement: AgentSessionMetadataPlacement;
}

const hasDisplayValue = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

export const AgentSessionMetadata = ({
  placement,
  provider,
  model,
  effort,
  fastMode,
  worktree,
  serviceNames = [],
}: AgentSessionMetadataProps) => {
  const displayModel = model.trim();
  const displayProvider = provider.trim();
  const displayEffort = effort?.trim();
  const displayFastMode = fastMode === true ? "fast" : undefined;
  const displayWorktree = worktree?.trim();

  if (!hasDisplayValue(displayModel)) {
    return null;
  }

  const copyWorktree = async (): Promise<void> => {
    if (!hasDisplayValue(displayWorktree)) return;

    try {
      await navigator.clipboard.writeText(displayWorktree);
    } catch (error) {
      console.error("Failed to copy worktree to clipboard:", error);
    }
  };

  const metadataRows: MetadataDisclosureRow[] = [];

  if (hasDisplayValue(displayProvider)) {
    metadataRows.push({
      label: "Provider",
      value: displayProvider,
      testId: "agent-session-metadata-provider",
    });
  }

  const modelMetadataRow: MetadataDisclosureRow = {
    label: "Model",
    value: displayModel,
    mobileTestId: "agent-session-metadata-model-detail",
    desktopTestId: "agent-session-metadata-model",
  };
  metadataRows.push(modelMetadataRow);

  if (hasDisplayValue(displayEffort)) {
    metadataRows.push({
      label: "Reasoning effort",
      value: displayEffort,
      testId: "agent-session-metadata-effort",
    });
  }

  if (hasDisplayValue(displayFastMode)) {
    metadataRows.push({
      label: "Fast mode",
      value: displayFastMode,
      testId: "agent-session-metadata-fast",
    });
  }

  if (hasDisplayValue(displayWorktree)) {
    metadataRows.push({
      label: "Worktree",
      value: displayWorktree,
      testId: "agent-session-metadata-worktree",
      onCopy: () => {
        void copyWorktree();
      },
    });
  }

  for (const name of serviceNames) {
    if (hasDisplayValue(name)) {
      metadataRows.push({
        label: "Service",
        value: name,
        testId: "agent-session-metadata-service",
      });
    }
  }

  const rootSx =
    placement === "below-composer"
      ? {
          flex: "1 1 auto",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
        }
      : {
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
        };

  return (
    <MetadataDisclosure
      rows={metadataRows}
      title="More details"
      testIdPrefix="agent-session-metadata"
      mobileBreakpoint="sm"
      dataPlacement={placement}
      mobileTrigger={{
        primaryRow: modelMetadataRow,
        closedAriaLabel: "Show more details",
        openAriaLabel: "Hide more details",
      }}
      sx={rootSx}
    />
  );
};
