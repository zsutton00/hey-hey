import { useEffect, useState } from "react";
import { fetchDemoSandboxAvailable } from "./landingPageCta";

/** `null` until the API has answered. */
export function useDemoSandboxAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchDemoSandboxAvailable().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}
