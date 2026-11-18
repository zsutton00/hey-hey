import { useEffect, useState } from "react";
import type { OrganizationResponseDto } from "@hey-hey/ui-common/api";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import { diagnosticFailureFacts } from "@hey-hey/ui-common/services";
import { getErrorMessage } from "@hey-hey/ui-common/utils";
import { recordLocalSetupEvent } from "../pages/LocalSetup/localSetupEvents";

export type SetupOrganization = Pick<OrganizationResponseDto, "id" | "name">;

export type SetupOrganizationState =
  | { kind: "loading" }
  | { kind: "loaded"; organization: SetupOrganization | null };

/**
 * The organization the setup session is signed in to, read once with that
 * session. It is null when the account isn't a member of it, which blocks
 * pairing rather than guessing.
 */
export function useSetupOrganization(
  organizationId: string | null,
): SetupOrganizationState {
  const [state, setState] = useState<SetupOrganizationState>({
    kind: "loading",
  });

  useEffect(() => {
    if (organizationId === null) {
      setState({ kind: "loaded", organization: null });
      return;
    }

    let active = true;
    setState({ kind: "loading" });
    getApiRuntime()
      .clients.organizations.getMyOrganizations()
      .then((response) => {
        if (!active) return;
        const organization =
          response.data.data?.find((org) => org.id === organizationId) ?? null;
        if (organization === null) {
          recordLocalSetupEvent(
            "organization: the session's organization is not among the account's memberships",
          );
        }
        setState({
          kind: "loaded",
          organization: organization && {
            id: organization.id,
            name: organization.name,
          },
        });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        recordLocalSetupEvent(
          `organization: load failed (${getErrorMessage(failure, "Unknown failure")})`,
          diagnosticFailureFacts(failure),
        );
        setState({ kind: "loaded", organization: null });
      });

    return () => {
      active = false;
    };
  }, [organizationId]);

  return state;
}
