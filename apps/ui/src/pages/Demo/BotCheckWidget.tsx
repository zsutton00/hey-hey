import { Box } from "@mui/material";
import { useEffect, useRef } from "react";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoad: Promise<TurnstileApi> | null = null;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error("Bot check script did not initialize"));
    script.onerror = () => reject(new Error("Bot check script failed to load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    turnstileLoad = null;
    throw error;
  });
  return turnstileLoad;
};

export interface BotCheckWidgetProps {
  siteKey: string;
  /** Called with a fresh single-use token, or null once it expires or errors. */
  onToken: (token: string | null) => void;
  /** Called when the widget cannot be loaded. */
  onUnavailable: () => void;
  /** Changing this value mounts a fresh challenge (tokens are single-use). */
  resetKey: number;
}

export const BotCheckWidget = ({
  siteKey,
  onToken,
  onUnavailable,
  resetKey,
}: BotCheckWidgetProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);
  onTokenRef.current = onToken;
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let widgetId: string | null = null;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current();
      });

    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, resetKey]);

  return <Box ref={containerRef} data-testid="demo-bot-check-widget" />;
};
