export type LandingCtaState = "welcome" | "signed-out" | "authenticated";

export const landingCtaByState = {
  "signed-out": {
    primary: { label: "Sign up", path: "/request-access" },
    demo: { label: "View demo", path: "/demo" },
    secondary: { label: "Existing User Sign In", path: "/login" },
  },
  authenticated: {
    primary: { label: "Go to my projects", path: "/home" },
  },
} as const;

// The landing page is static and cannot use the application runtime, so it
// reads the API's public availability answer with a plain request. Anything
// short of a confirmed "available" hides View demo rather than offering a
// start that could be refused.
export async function fetchDemoSandboxAvailable(): Promise<boolean> {
  const config = (
    window as typeof window & {
      __HEY_HEY_RUNTIME_CONFIG__?: { apiUrl?: unknown };
    }
  ).__HEY_HEY_RUNTIME_CONFIG__;
  const apiUrl =
    typeof config?.apiUrl === "string" && config.apiUrl
      ? config.apiUrl
      : "/api/v1";
  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/demo-sandboxes/availability`,
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { available?: unknown } };
    return body.data?.available === true;
  } catch {
    return false;
  }
}

export function getLandingCtaState(input: {
  isWelcomeFlow: boolean;
  user: { userId: string } | null;
}): LandingCtaState {
  if (input.isWelcomeFlow) return "welcome";
  return input.user ? "authenticated" : "signed-out";
}
