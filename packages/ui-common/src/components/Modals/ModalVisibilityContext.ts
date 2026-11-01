import { createContext } from "react";

// React context follows portals, so nested dialogs release their own ModalManager
// entries when their owner is hidden, without discarding pending confirmation state.
export const ModalVisibilityContext = createContext(false);
