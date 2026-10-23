import { atomWithStorage } from "jotai/utils";
import type { ScratchpadItem } from "./types";

export const scratchpadAtom = atomWithStorage<ScratchpadItem[]>(
  "hey-scratchpad-items",
  []
);
