import { useCallback, useContext, useEffect, useId, useState } from "react";
import { ModalMinimizeContext } from "./ModalMinimizeContext";
import { ModalVisibilityContext } from "./ModalVisibilityContext";
import { ModalWorkOwner } from "./ModalWorkOwner";
import { registerMinimizedWork } from "./modalWorkRegistry";
import { useModalFocus } from "./useModalFocus";

export function useModalPresentation(
  open: boolean,
  title: string,
  root: HTMLElement | null,
  ownerKey: string | undefined,
) {
  const parentMinimize = useContext(ModalMinimizeContext);
  const inheritedOwner = useContext(ModalWorkOwner);
  const registrationOwner = ownerKey ?? inheritedOwner;
  const parentHidden = useContext(ModalVisibilityContext);
  const id = useId();
  const [minimized, setMinimized] = useState(false);
  const hidden = minimized || parentHidden;
  const visible = open && !hidden;
  const { saveFocus, rememberFocus } = useModalFocus(visible, root);
  const [childrenReady, setChildrenReady] = useState(false);
  // ModalManager must admit the parent before its descendants. Simultaneous
  // restoration can otherwise hide a child and leave competing focus traps.
  useEffect(() => {
    setChildrenReady(visible);
  }, [visible]);
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);
  const restore = useCallback(() => setMinimized(false), []);
  useEffect(() => {
    if (!open || !minimized || parentHidden) return;
    return registerMinimizedWork({
      id,
      title,
      restore,
      ownerKey: registrationOwner,
    });
  }, [open, minimized, parentHidden, id, title, restore, registrationOwner]);
  const minimizeSelf = () => {
    saveFocus();
    setMinimized(true);
  };
  return {
    hidden,
    visible,
    minimize: parentMinimize ?? minimizeSelf,
    rememberFocus,
    childrenHidden: hidden || !open || !childrenReady,
  };
}
