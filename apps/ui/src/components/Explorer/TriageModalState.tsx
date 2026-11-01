import type { ReactNode } from "react";
import { Stack } from "@mui/material";
import { OpenItemsTriageModalHeader } from "./OpenItemsTriageModalHeader";

export function TriageModalState({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Stack spacing={2}>
      <OpenItemsTriageModalHeader onClose={onClose} />
      {children}
    </Stack>
  );
}
