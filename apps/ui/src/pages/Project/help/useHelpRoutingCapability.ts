import { useMemo } from "react";

import type { HelpRoutingCapability } from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common/services";

/**
 * Web-platform implementation of the help routing capability.
 *
 * Maps semantic CTA intents emitted by help scenarios to concrete hrefs over
 * `WebPathService`. The `create-a-service` scenario routes to the project's
 * Services tab, where the create-service flow lives; other scenarios attach a
 * CTA without a second wiring pass. Unknown intents fall back to the project
 * root.
 */
export function useHelpRoutingCapability(
  projectId: string,
): HelpRoutingCapability {
  return useMemo<HelpRoutingCapability>(() => {
    const projectRoot = WebPathService.project(projectId);
    return {
      buildHref(intent: string): string {
        switch (intent) {
          case "install-agent-bridge":
            return `/projects/${projectId}/settings`;
          case "node-installer":
            return "https://nodejs.org/";
          case "settings-machines":
            return `/projects/${projectId}/settings`;
          case "create-service":
            return `${projectRoot}?tab=services`;
          case "open-features":
            return `${projectRoot}?tab=features`;
          case "open-tasks":
            return `${projectRoot}?tab=tasks`;
          case "read-first-project":
            return `${projectRoot}?tab=help&helpSubTab=first-project`;
          case "project-root":
            return projectRoot;
          default:
            return projectRoot;
        }
      },
    };
  }, [projectId]);
}
