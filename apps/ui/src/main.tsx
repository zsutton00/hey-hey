import { isStandaloneLanding } from "./pages/Landing/entryRoute";
import { isLocalSetupEntry } from "./localSetup/entryRoute";

// Keep all app imports behind this boundary, including its CSS and providers.
// Invitations use the existing welcome/sign-in flow in the application.
// Local first-time setup is its own app and never loads the main app.
if (isStandaloneLanding(window.location)) {
  void import("./pages/Landing/mountLanding").then(({ mountLanding }) => {
    mountLanding(document.getElementById("root")!);
  });
} else if (isLocalSetupEntry(window.location)) {
  void import("./localSetup/mountLocalSetup").then(({ mountLocalSetup }) => {
    mountLocalSetup(document.getElementById("root")!);
  });
} else {
  void import("./appMain");
}
