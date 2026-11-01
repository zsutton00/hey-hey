import { useLayoutEffect, useState } from "react";

export function useModalTitle(
  open: boolean,
  root: HTMLElement | null,
  workTitle: string | undefined,
  labelledBy: string | undefined,
) {
  const [title, setTitle] = useState(workTitle ?? "");
  const [needsHeading, setNeedsHeading] = useState(false);
  useLayoutEffect(() => {
    if (!open || !root) return;
    const update = () => {
      const label = labelledBy ? document.getElementById(labelledBy) : null;
      const heading = root.querySelector(
        ".MuiDialogTitle-root:not([data-modal-title]), h1:not([data-modal-title]), h2:not([data-modal-title]), h3:not([data-modal-title]), h4:not([data-modal-title]), h5:not([data-modal-title]), h6:not([data-modal-title])",
      );
      setNeedsHeading(!heading && !label);
      setTitle(
        workTitle ??
          label?.textContent?.trim() ??
          heading?.textContent?.trim() ??
          "Dialog",
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [open, root, workTitle, labelledBy]);
  return { title, needsHeading };
}
