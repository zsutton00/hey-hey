import { useMediaQuery } from "@mui/material";

const HOVER_CAPABLE_QUERY = "(hover: hover) and (pointer: fine)";

export const useCanHover = (): boolean => {
  return useMediaQuery(HOVER_CAPABLE_QUERY, { defaultMatches: true });
};
