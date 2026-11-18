import { useEffect } from "react";
import { useActionsCapsule } from "./ActionsCapsuleContext";
import type { CapsuleScreenButton } from "./types";

/** Registers a screen control; use stable callbacks as with CapsuleAction. */
export function useCapsuleScreenButton(button: CapsuleScreenButton): void {
  const { registerScreenButton, unregisterScreenButton } = useActionsCapsule();
  const { key, label, icon, accessibleName, onClick, status } = button;
  const state = status?.state;
  const text = status?.text;
  useEffect(() => {
    registerScreenButton(button);
  }, [
    key,
    label,
    icon,
    accessibleName,
    onClick,
    state,
    text,
    registerScreenButton,
  ]);
  useEffect(
    () => () => unregisterScreenButton(key),
    [key, unregisterScreenButton],
  );
}
