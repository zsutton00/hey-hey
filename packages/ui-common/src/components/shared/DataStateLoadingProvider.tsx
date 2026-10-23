import { Box } from "@mui/material";
import { useCallback, useState, type ReactNode } from "react";
import { DataStateLoadingContext } from "./dataStateLoadingContext";
import { SharedLoading } from "./SharedLoading";

/** Keep one loading presentation mounted across sequential descendant reads. */
export const DataStateLoadingProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [pending, setPending] = useState<ReadonlySet<symbol>>(() => new Set());
  const register = useCallback((token: symbol) => {
    setPending((current) => new Set(current).add(token));
    return () =>
      setPending((current) => {
        const next = new Set(current);
        next.delete(token);
        return next;
      });
  }, []);
  const loading = pending.size > 0;

  return (
    <DataStateLoadingContext.Provider value={register}>
      <Box
        sx={{ position: "relative", width: "100%", minWidth: 0, flex: 1 }}
        aria-busy={loading}
      >
        {loading && (
          <Box sx={{ position: "absolute", inset: "0 0 auto", zIndex: 1 }}>
            <SharedLoading />
          </Box>
        )}
        <Box
          data-testid="data-state-loading-content"
          inert={loading}
          sx={{
            visibility: loading ? "hidden" : "visible",
            opacity: loading ? 0 : 1,
            transition: loading ? "none" : "opacity 100ms ease-out",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        >
          {children}
        </Box>
      </Box>
    </DataStateLoadingContext.Provider>
  );
};
