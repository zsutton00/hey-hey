import { useState, useEffect, useRef, useCallback } from "react";

interface UseDoubleSpaceModalOptions {
  timeWindow?: number; // Time window for double press in milliseconds
}

export const useDoubleSpaceModal = (
  options: UseDoubleSpaceModalOptions = {}
) => {
  const { timeWindow = 500 } = options;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const lastSpacePressRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Only respond to space key presses
      if (event.code !== "Space") {
        return;
      }

      // Ignore if user is typing in an input field
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true" ||
        target.getAttribute("role") === "textbox"
      ) {
        return;
      }

      const currentTime = Date.now();
      const timeSinceLastPress = currentTime - lastSpacePressRef.current;

      if (timeSinceLastPress <= timeWindow) {
        // Double space detected
        event.preventDefault();
        setIsModalOpen(true);
        lastSpacePressRef.current = 0; // Reset to prevent triple space issues

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      } else {
        // First space press or too much time has passed
        lastSpacePressRef.current = currentTime;

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Set timeout to reset after time window
        timeoutRef.current = setTimeout(() => {
          lastSpacePressRef.current = 0;
          timeoutRef.current = null;
        }, timeWindow);
      }
    },
    [timeWindow]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleKeyDown]);

  const openModal = () => setIsModalOpen(true);

  const closeModal = () => {
    setIsModalOpen(false);
    setInputValue("");
  };

  const handleSubmit = (callback?: (value: string) => void) => {
    if (callback && inputValue.trim()) {
      callback(inputValue.trim());
    }
    closeModal();
  };

  return {
    isModalOpen,
    inputValue,
    setInputValue,
    openModal,
    closeModal,
    handleSubmit,
  };
};
