import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getDeployment } from "@hey-hey/ui-common/services";
import NotFound from "../pages/NotFound";
import { loadDocument } from "./loadDocument";

/**
 * The main app's `/local` address. Setup never runs inside the main app: in a
 * local deployment an in-app visit (the local sign-in's return, the pairing
 * page's way back) reloads the page so the setup app starts on its own.
 * Hosted deployments have no local setup.
 */
export function LocalSetupRoute(): React.JSX.Element | null {
  const location = useLocation();
  const local = getDeployment() === "local";

  useEffect(() => {
    if (local) {
      loadDocument(`${location.pathname}${location.search}${location.hash}`);
    }
  }, [local, location]);

  return local ? null : <NotFound />;
}
