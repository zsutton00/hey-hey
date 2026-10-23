import QuestionIcon from "@mui/icons-material/QuestionMark";
import { type JSX } from "react";
import { useLocation } from "react-router-dom";
import { usePathService } from "../../contexts";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import type { Stable } from "../../types";
import type { CapsuleActionRegistration } from "./types";

/**
 * Search button that registers and triggers the search action.
 * Integrates with ActionsCapsule system as a proper action.
 *
 * When clicked, expands the capsule to show the search UI.
 */
export const useSiteChat = ({
  renderContent,
}: {
  renderContent: Stable<() => JSX.Element>;
}): CapsuleActionRegistration => {
  const location = useLocation();
  const userIdentity = useUserIdentity();
  const pathService = usePathService();

  // Get context (called unconditionally to comply with React hooks rules)
  const organizationId = userIdentity?.currentOrgId;
  const projectId = pathService.extractProjectId(location.pathname);
  const hasContext = !!(organizationId && projectId);

  return {
    id: "site-chat",
    label: "Ask",
    icon: QuestionIcon,
    behavior: "expand",
    actionGroup: "conceptual",
    tier: "site",
    order: 10,
    disabled: !hasContext,
    title: "Search",
    inProgress: false,
    renderContent: renderContent,
  };
};
