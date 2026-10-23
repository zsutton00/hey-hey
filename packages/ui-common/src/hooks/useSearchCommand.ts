import { useState, useEffect, useCallback } from "react";

interface UseSearchCommandOptions {
  triggerSequence?: string;
  enabled?: boolean;
}

export const useSearchCommand = (options: UseSearchCommandOptions = {}) => {
  const { triggerSequence = "   ", enabled = true } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [, setKeySequence] = useState("");

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only track space key presses
      if (event.key === " ") {
        setKeySequence((prev) => {
          const newSequence = prev + " ";

          // Check if we've reached the trigger sequence
          if (newSequence === triggerSequence) {
            // Prevent the space from being typed
            event.preventDefault();
            setIsOpen(true);
            return "";
          }

          // Keep only the last characters up to trigger length
          return newSequence.slice(-triggerSequence.length);
        });
      } else {
        // Reset sequence on any non-space key
        setKeySequence("");
      }
    };

    // Reset sequence when search command is closed
    if (!isOpen) {
      setKeySequence("");
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, triggerSequence, isOpen]);

  return {
    isOpen,
    open,
    close,
  };
};
