import { useEffect, useState } from "react";
import { Alert, Skeleton, Stack, Typography } from "@mui/material";
import type { ServicePlaceChoice } from "../../api";
import { WorkInSelect, conflictsWithMainFolder } from "./WorkInSelect";
import {
  useServicePlaces,
  type ServicePlacesEntry,
} from "./runtime/hooks/useServicePlaces";
import { useBranchNameSuggester } from "./runtime/hooks/useBranchNameSuggester";
import type { RegisterOpenNameField } from "./useOpenNameFields";

const NOT_RETURNED_ENTRY: ServicePlacesEntry = {
  status: "error",
  message: "Where this Service can work was not returned for this machine.",
};

export interface ServicesWorkInProps {
  organizationId: string;
  projectId: string;
  machineId: string;
  /**
   * Services to choose for, with the name to show above each when several.
   * `requireChoice` Services have no default: they show a prompt until chosen.
   */
  services: readonly {
    serviceId: string;
    name?: string;
    requireChoice?: boolean;
  }[];
  /** Current choice per Service; a missing entry means the main folder unless the Service requires a choice. */
  choices: Readonly<Record<string, ServicePlaceChoice>>;
  disabled: boolean;
  /** Names a new worktree; null when the surface is about no work item. */
  workItemName: string | null;
  /** Lets the caller hold its start action while a branch name is open. */
  registerOpenNameField: RegisterOpenNameField;
  onChange: (choice: ServicePlaceChoice) => void;
  /**
   * True until every listed Service's places are shown and its choice can be
   * applied (still loading, unreadable, or a worktree on a branch the main
   * folder holds), so the caller holds the action that needs a choice.
   */
  onUnavailableChange: (unavailable: boolean) => void;
}

/** Work in choices for Services outside the launch screen, read from one machine. */
export const ServicesWorkIn = ({
  organizationId,
  projectId,
  machineId,
  services,
  choices,
  disabled,
  workItemName,
  registerOpenNameField,
  onChange,
  onUnavailableChange,
}: ServicesWorkInProps) => {
  const [branchQuery, setBranchQuery] = useState("");
  const places = useServicePlaces({
    enabled: true,
    organizationId,
    projectId,
    machineId,
    serviceIds: services.map((service) => service.serviceId),
    branchQuery,
  });
  const suggestBranchName = useBranchNameSuggester({
    organizationId,
    projectId,
    machineId,
    workItemName,
  });

  const unavailable =
    places.status !== "ready" ||
    services.some(({ serviceId }) => {
      const entry = places.byServiceId[serviceId] ?? NOT_RETURNED_ENTRY;

      return (
        entry.status === "error" ||
        conflictsWithMainFolder(entry, choices[serviceId] ?? null)
      );
    });
  useEffect(() => {
    onUnavailableChange(unavailable);
    return () => onUnavailableChange(false);
  }, [unavailable, onUnavailableChange]);

  if (places.status === "unavailable") {
    return (
      <Alert severity="error" data-testid="services-work-in-unavailable">
        Where each Service can work could not be loaded: {places.message}
      </Alert>
    );
  }
  if (places.status !== "ready") {
    return <Skeleton variant="rounded" height={40} />;
  }

  return (
    <Stack spacing={1} data-testid="services-work-in">
      {services.map(({ serviceId, name, requireChoice = false }) => (
        <Stack key={serviceId} spacing={0.5}>
          {name ? (
            <Typography variant="caption" color="text.secondary">
              {name}
            </Typography>
          ) : null}
          <WorkInSelect
            serviceId={serviceId}
            entry={places.byServiceId[serviceId] ?? NOT_RETURNED_ENTRY}
            value={choices[serviceId] ?? null}
            requireChoice={requireChoice}
            lockedBranch={null}
            searching={places.searching}
            searchError={places.searchError}
            disabled={disabled}
            suggestBranchName={suggestBranchName}
            branchNameServiceIds={[serviceId]}
            registerOpenNameField={registerOpenNameField}
            onBranchQueryChange={setBranchQuery}
            onChange={onChange}
          />
        </Stack>
      ))}
    </Stack>
  );
};
