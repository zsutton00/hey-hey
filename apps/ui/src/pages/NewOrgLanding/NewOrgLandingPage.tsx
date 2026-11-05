import { TrackingProvider, useAuth } from "@hey-hey/ui-common/context";

import { HostedWelcome } from "./HostedWelcome";
import { LocalWelcome } from "./LocalWelcome";

/** `/welcome` route: local and hosted accounts each get their own wrapper around the shared WelcomeSteps. */
const NewOrgLandingPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <TrackingProvider
      context={{
        page: {
          name: "new-org-landing",
          path: window.location.pathname,
          section: "welcome",
        },
      }}
      enabled={true}
    >
      {user?.isLocalAccount ? <LocalWelcome /> : <HostedWelcome />}
    </TrackingProvider>
  );
};

export default NewOrgLandingPage;
