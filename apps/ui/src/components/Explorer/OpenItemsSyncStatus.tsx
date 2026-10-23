import { CircularProgress } from "@mui/material";
import { useOpenItems } from "../../contexts/OpenItemsContext";

export function OpenItemsSyncStatus() {
  const { pending, queued } = useOpenItems();
  if (pending <= queued) return null;
  return (
    <CircularProgress
      data-testid="open-items-saving"
      aria-label="Saving Open Items"
      size={10}
      thickness={3}
      sx={{
        position: "absolute",
        right: 4,
        top: 4,
        opacity: 0.25,
        color: "text.secondary",
        pointerEvents: "none",
      }}
    />
  );
}
