import { createContext, useContext } from "react";

export const ModalShellContext = createContext(false);
export const useModalShell = () => useContext(ModalShellContext);
