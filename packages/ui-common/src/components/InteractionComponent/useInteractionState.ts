import { useCallback, useReducer } from "react";
import type { InteractionState, MenuPosition } from "./types";

interface ReducerState {
  interaction: InteractionState;
  mouseOver: boolean;
  menuPosition: MenuPosition | null;
}

type InteractionAction =
  | { type: "MOUSE_ENTER" }
  | { type: "MOUSE_LEAVE" }
  | { type: "OPEN_MENU"; position: MenuPosition }
  | { type: "CLOSE_MENU" };

const initialState: ReducerState = {
  interaction: "idle",
  mouseOver: false,
  menuPosition: null,
};

function interactionReducer(
  state: ReducerState,
  action: InteractionAction
): ReducerState {
  switch (action.type) {
    case "MOUSE_ENTER":
      return state.interaction === "menuOpen"
        ? { ...state, mouseOver: true }
        : { ...state, interaction: "hovering", mouseOver: true };
    case "MOUSE_LEAVE":
      return state.interaction === "menuOpen"
        ? { ...state, mouseOver: false }
        : { ...state, interaction: "idle", mouseOver: false };
    case "OPEN_MENU":
      return {
        ...state,
        interaction: "menuOpen",
        menuPosition: action.position,
      };
    case "CLOSE_MENU":
      return {
        interaction: state.mouseOver ? "hovering" : "idle",
        mouseOver: state.mouseOver,
        menuPosition: null,
      };
  }
}

export function useInteractionState() {
  const [{ interaction: state, menuPosition }, dispatch] = useReducer(
    interactionReducer,
    initialState
  );

  const handleMouseEnter = useCallback(() => {
    dispatch({ type: "MOUSE_ENTER" });
  }, []);

  const handleMouseLeave = useCallback(() => {
    dispatch({ type: "MOUSE_LEAVE" });
  }, []);

  const openMenu = useCallback((position: MenuPosition) => {
    dispatch({ type: "OPEN_MENU", position });
  }, []);

  const closeMenu = useCallback(() => {
    dispatch({ type: "CLOSE_MENU" });
  }, []);

  return {
    state,
    menuPosition,
    handleMouseEnter,
    handleMouseLeave,
    openMenu,
    closeMenu,
  } as const;
}
