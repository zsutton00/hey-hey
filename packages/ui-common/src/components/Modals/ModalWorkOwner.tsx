import { createContext } from "react";

/** Names work across a dispatcher that supplies several independent dialogs. */
export const ModalWorkOwner = createContext<string | undefined>(undefined);
