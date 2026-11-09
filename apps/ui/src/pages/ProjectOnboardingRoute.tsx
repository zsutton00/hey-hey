import { lazy } from "react";
import { useAuth } from "@hey-hey/ui-common/context";

const HostedOnboarding = lazy(() => import("./Onboarding"));
const LocalOnboarding = lazy(
  () => import("./LocalOnboarding/LocalOnboardingPage"),
);

/** `/projects/:projectId/onboarding`: local and hosted accounts each have their own onboarding page. */
export const ProjectOnboardingRoute = () => {
  const { user } = useAuth();

  return user?.isLocalAccount ? <LocalOnboarding /> : <HostedOnboarding />;
};
