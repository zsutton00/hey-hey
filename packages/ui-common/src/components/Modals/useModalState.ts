import {
  useCallback,
  useId,
  useRef,
  useState,
  type SetStateAction,
} from "react";

/** Opening existing work restores its presentation without changing its lifetime. */
export function useModalState(initialState: boolean | (() => boolean) = false) {
  const ownerKey = useId();
  const [open, setOpen] = useState(initialState);
  const current = useRef(open);
  current.current = open;
  const setModalOpen = useCallback(
    (update: SetStateAction<boolean>) => {
      const next =
        typeof update === "function" ? update(current.current) : update;
      current.current = next;
      setOpen(next);
    },
    [ownerKey],
  );
  return [open, setModalOpen, ownerKey] as const;
}
