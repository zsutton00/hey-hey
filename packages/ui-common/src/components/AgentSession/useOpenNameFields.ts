import { useCallback, useState } from "react";

/** Marks a branch name field as open; the returned function releases it. */
export type RegisterOpenNameField = () => () => void;

/**
 * Counts the open branch name fields on one surface, so it can hold starting
 * until each has been accepted, cancelled or removed.
 */
export const useOpenNameFields = (): {
  nameOpen: boolean;
  registerOpenNameField: RegisterOpenNameField;
} => {
  const [openCount, setOpenCount] = useState(0);
  const registerOpenNameField = useCallback(() => {
    setOpenCount((count) => count + 1);

    return () => setOpenCount((count) => count - 1);
  }, []);

  return { nameOpen: openCount > 0, registerOpenNameField };
};
