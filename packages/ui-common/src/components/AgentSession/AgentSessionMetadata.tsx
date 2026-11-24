import { MetadataDisclosure } from "../shared/MetadataDisclosure";
import type { MetadataDisclosureRow } from "../shared/MetadataDisclosure";
import type { AgentProvider, ReasoningEffort } from "./runtime/types";

export type AgentSessionMetadataPlacement =
  "below-composer" | "below-conversation";

export interface AgentSessionMetadataValues {
  provider: AgentProvider;
  model: string;
  effort?: ReasoningEffort;
  fastMode?: boolean;
  servicePlaces?: readonly AgentSessionServicePlaceEntry[];
}

export type AgentSessionServicePlaceView =
  | { kind: "worktree"; branch: string }
  | { kind: "main-folder"; branch: string | null }
  | { kind: "not-recorded" };

export interface AgentSessionServicePlaceEntry {
  serviceName: string;
  place: AgentSessionServicePlaceView;
}

const SERVICE_PLACES_GROUP = "Where each Service works";

const describePlace = (place: AgentSessionServicePlaceView): string => {
  switch (place.kind) {
    case "worktree":
      return place.branch;
    case "main-folder":
      return place.branch ?? "detached";
    case "not-recorded":
      return "Not recorded";
  }
};

const placeTestId = (place: AgentSessionServicePlaceView): string => {
  switch (place.kind) {
    case "worktree":
      return "agent-session-metadata-place-worktree";
    case "main-folder":
      return place.branch === null
        ? "agent-session-metadata-place-detached"
        : "agent-session-metadata-place-main";
    case "not-recorded":
      return "agent-session-metadata-place-not-recorded";
  }
};

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
  servicePlaces = [],
}: AgentSessionMetadataProps) => {
  const displayModel = model.trim();
  const displayProvider = provider.trim();
  const displayEffort = effort?.trim();
  const displayFastMode = fastMode === true ? "fast" : undefined;

  if (!hasDisplayValue(displayModel)) {
    return null;
  }

  const copyBranch = async (branch: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(branch);
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

  servicePlaces.forEach(({ serviceName, place }, index) => {
    const value = describePlace(place);
    const row: MetadataDisclosureRow = {
      label: serviceName,
      value,
      desktopText: `${serviceName}: ${value}`,
      group: SERVICE_PLACES_GROUP,
      testId: placeTestId(place),
      ...(place.kind === "not-recorded" ? { dashed: true } : {}),
      ...(place.kind === "worktree"
        ? {
            copyTestId: `agent-session-metadata-place-copy-${index}`,
            onCopy: () => {
              void copyBranch(place.branch);
            },
          }
        : {}),
    };
    metadataRows.push(row);
  });

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
