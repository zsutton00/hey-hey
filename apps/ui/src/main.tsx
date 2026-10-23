import { isStandaloneLanding } from "./pages/Landing/entryRoute";

// Keep all app imports behind this boundary, including its CSS and providers.
// Invitations use the existing welcome/sign-in flow in the application.
if (isStandaloneLanding(window.location)) {
  void import("./pages/Landing/mountLanding").then(({ mountLanding }) => {
    mountLanding(document.getElementById("root")!);
  });
} else {
  void import("./appMain");
}
