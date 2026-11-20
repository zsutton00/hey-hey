import { Box, Typography } from "@mui/material";
import { motion, useIsPresent } from "motion/react";
import { createContext, useContext, type ReactNode } from "react";

export const OpenItemPresenceContext = createContext<ReadonlySet<string>>(
  new Set(),
);

/** Removed rows stop owning links and controls immediately; only their label exits. */
export function OpenItemPresenceRow({
  itemKey,
  label,
  reducedMotion,
  children,
}: {
  itemKey: string;
  label: string | undefined;
  reducedMotion: boolean | null;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const canonicalKeys = useContext(OpenItemPresenceContext);
  const removed = !canonicalKeys.has(itemKey);
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.15 }}
    >
      {present ? (
        children
      ) : removed && label ? (
        <Box aria-hidden="true" sx={{ px: 2, py: 0.5, pointerEvents: "none" }}>
          <Typography variant="body2" noWrap>
            {label}
          </Typography>
        </Box>
      ) : null}
    </motion.div>
  );
}
