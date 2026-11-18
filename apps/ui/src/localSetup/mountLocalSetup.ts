import { getDeployment } from "@hey-hey/ui-common/services";

/**
 * `/local` loads the setup app in a local deployment and the main app
 * everywhere else. Each choice is a separate import, so a hosted deployment
 * never downloads setup and setup never starts the main app.
 */
export function mountLocalSetup(root: HTMLElement): void {
  if (getDeployment() !== "local") {
    void import("../appMain");
    return;
  }

  void import("./startLocalSetupApp").then(({ startLocalSetupApp }) => {
    startLocalSetupApp(root);
  });
}
