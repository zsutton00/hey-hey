import { useLayoutEffect, useRef, type RefObject } from "react";
import { useTheme } from "@mui/material";

/** A local Start gesture is animated only after canonical execution changes. */
export function useTaskMonitorDockMotion({
  monitorId,
  setup,
  hasCommittedExecution,
  composing,
  monitorOpen,
  monitorRef,
  startIntent,
}: {
  monitorId: string;
  setup: boolean;
  hasCommittedExecution: boolean;
  composing: boolean;
  monitorOpen: boolean;
  monitorRef: RefObject<HTMLDivElement | null>;
  startIntent: RefObject<boolean>;
}) {
  const theme = useTheme();
  const lastMonitorRect = useRef<DOMRect | null>(null);
  const lastMonitorContent = useRef<Node | null>(null);
  useLayoutEffect(() => {
    if (monitorOpen && monitorRef.current) {
      lastMonitorRect.current = monitorRef.current.getBoundingClientRect();
      lastMonitorContent.current = monitorRef.current.cloneNode(true);
    }
    if (setup || !hasCommittedExecution || !startIntent.current || composing) {
      return;
    }
    startIntent.current = false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let ghost: HTMLDivElement | null = null;
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const destination = Array.from(
        document.querySelectorAll<HTMLElement>("[data-screen-key]"),
      ).find(
        (element) => element.dataset.screenKey === `task-monitor:${monitorId}`,
      );
      const mobileAnchor = document.querySelector<HTMLElement>(
        '[data-testid="capsule-toggle"], [data-testid="capsule-restore-button"]',
      );
      const target = destination?.getBoundingClientRect();
      const end =
        target && target.width ? target : mobileAnchor?.getBoundingClientRect();
      const begin = lastMonitorRect.current;
      if (!begin || !end || !begin.width || !end.width) {
        return;
      }
      ghost = document.createElement("div");
      ghost.inert = true;
      if (lastMonitorContent.current) {
        ghost.appendChild(lastMonitorContent.current);
      }
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${begin.left}px`,
        top: `${begin.top}px`,
        width: `${begin.width}px`,
        height: `${begin.height}px`,
        background: theme.palette.background.paper,
        color: theme.palette.text.primary,
        border: `1px solid ${theme.palette.primary.main}`,
        borderRadius: "8px",
        pointerEvents: "none",
        zIndex: "2000",
        transformOrigin: "top left",
      });
      document.body.appendChild(ghost);
      animation = ghost.animate?.(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 0.8 },
          {
            transform: `translate(${end.left - begin.left}px, ${end.top - begin.top}px) scale(${end.width / begin.width}, ${end.height / begin.height})`,
            opacity: 0.5,
          },
        ],
        { duration: 450, easing: "ease-in-out" },
      );
      if (animation) {
        animation.onfinish = () => ghost?.remove();
        animation.oncancel = () => ghost?.remove();
      } else {
        ghost.remove();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      ghost?.remove();
    };
  }, [
    setup,
    hasCommittedExecution,
    composing,
    monitorId,
    monitorOpen,
    monitorRef,
    startIntent,
    theme,
  ]);
}
