import { getDeployment } from "@hey-hey/ui-common/services";
import Home from "./Home";
import { LocalLogin } from "./LocalLogin";

// A local owner never sees the hosted landing page; `/` uses the same entry
// as the local login page, which restores the session and opens the workspace.
export default function HomeRoute() {
  return getDeployment() === "local" ? <LocalLogin /> : <Home />;
}
