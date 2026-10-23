import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HELP_DEMO_FALLBACK } from "../helpCapabilities";
import type { HelpCapabilities } from "../helpCapabilities";
import { HelpProvider, useHelp, useOptionalHelp } from "../HelpContext";

const STUB_CAPABILITIES: HelpCapabilities = {
  data: { features: [] },
  actions: {
    "import-repository": {
      status: "ready",
      error: null,
      execute: vi.fn(),
      retry: vi.fn(),
    },
  },
  routing: { buildHref: (intent: string) => `/${intent}` },
  demos: {
    "read-first-project": HELP_DEMO_FALLBACK,
    "install-agent-bridge": HELP_DEMO_FALLBACK,
    "features-ready": HELP_DEMO_FALLBACK,
    "create-a-task": HELP_DEMO_FALLBACK,
    "first-agent-session": HELP_DEMO_FALLBACK,
  },
};

describe("HelpProvider", () => {
  it("renders children", () => {
    render(
      <HelpProvider capabilities={STUB_CAPABILITIES}>
        <p>child content</p>
      </HelpProvider>
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("provides capabilities via useHelp", () => {
    let received: HelpCapabilities | null = null;

    const Consumer = () => {
      received = useHelp();
      return null;
    };

    render(
      <HelpProvider capabilities={STUB_CAPABILITIES}>
        <Consumer />
      </HelpProvider>
    );

    expect(received).toBe(STUB_CAPABILITIES);
  });

  it("throws when useHelp is called outside a provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const Consumer = () => {
      useHelp();
      return null;
    };

    expect(() => render(<Consumer />)).toThrow(
      "useHelp must be used within a HelpProvider"
    );

    consoleError.mockRestore();
  });

  it("returns null from useOptionalHelp outside a provider", () => {
    let received: HelpCapabilities | null =
      "not-null" as unknown as HelpCapabilities | null;

    const Consumer = () => {
      received = useOptionalHelp();
      return null;
    };

    render(<Consumer />);

    expect(received).toBeNull();
  });

  it("HELP_DEMO_FALLBACK is a distinct sentinel", () => {
    expect(HELP_DEMO_FALLBACK).toBeTypeOf("symbol");
    expect(HELP_DEMO_FALLBACK).not.toBe(null);
    expect(HELP_DEMO_FALLBACK).not.toBe(undefined);
    expect(String(HELP_DEMO_FALLBACK)).toBe("Symbol(HELP_DEMO_FALLBACK)");
  });

  it("HelpDemoMap rejects undefined as a demo value (compile-time)", () => {
    // @ts-expect-error — undefined must not satisfy PlatformDemo; only the
    // explicit HELP_DEMO_FALLBACK sentinel may stand in for "no demo".
    const _invalid: HelpCapabilities["demos"] = {
      "install-agent-bridge": undefined,
      "features-ready": HELP_DEMO_FALLBACK,
      "create-a-task": HELP_DEMO_FALLBACK,
      "first-agent-session": HELP_DEMO_FALLBACK,
    };
    void _invalid;
  });
});
