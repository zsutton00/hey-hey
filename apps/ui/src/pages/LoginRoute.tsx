import { getDeployment } from "@hey-hey/ui-common/services";
import Login from "./Login";
import { LocalLogin } from "./LocalLogin";

export default function LoginRoute() {
  return getDeployment() === "local" ? <LocalLogin /> : <Login />;
}
