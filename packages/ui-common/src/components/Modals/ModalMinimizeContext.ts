import { createContext } from "react";

/** A confirmation belongs to its parent's open work, including minimization. */
export const ModalMinimizeContext = createContext<(() => void) | null>(null);
