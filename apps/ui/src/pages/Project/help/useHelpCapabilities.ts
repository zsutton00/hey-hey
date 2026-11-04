import { useUserPairedMachines } from "@hey-hey/ui-common/data";
import { useMemo } from "react";

import type {
  HelpActionCapability,
  HelpCapabilities,
} from "@hey-hey/ui-common/components";

import { buildHelpDemoMap } from "./helpDemoMap";
import { useHelpDataCapability } from "./useHelpDataCapability";
import { useHelpRoutingCapability } from "./useHelpRoutingCapability";

/**
 * Composes the full set of help capabilities the web platform supplies to
 * `HelpProvider`. Combines the live-data capability, the routing resolver,
 * and the platform demo map into a single memoized object so consumers can
 * pass one value to the provider.
 */
export function useHelpCapabilities(
  organizationId: string,
  projectId: string,
  importAction: HelpActionCapability,
): HelpCapabilities {
  const data = useHelpDataCapability(organizationId, projectId);
  const { machines } = useUserPairedMachines();
  const bridgeConnected = machines.some(
    (machine) => machine.active && !machine.revokedAt,
  );
  const routing = useHelpRoutingCapability(projectId);

  return useMemo<HelpCapabilities>(
    () => ({
      actions: { "import-repository": importAction },
      data: { ...data, bridgeConnected },
      routing,
      demos: buildHelpDemoMap(organizationId, projectId),
    }),
    [data, bridgeConnected, routing, organizationId, projectId, importAction],
  );
}
