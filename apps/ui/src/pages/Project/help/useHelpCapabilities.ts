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
  const routing = useHelpRoutingCapability(projectId);

  return useMemo<HelpCapabilities>(
    () => ({
      actions: { "import-repository": importAction },
      data,
      routing,
      demos: buildHelpDemoMap(organizationId, projectId),
    }),
    [data, routing, organizationId, projectId, importAction],
  );
}
