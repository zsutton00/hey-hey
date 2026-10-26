import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

/** Each domain has a separate store owned by its application-level provider. */
export function createUiDomain<State>(createStore: () => StoreApi<State>) {
  const Context = createContext<StoreApi<State> | null>(null);
  function Provider({ children }: { children: ReactNode }) {
    const [store] = useState(createStore);
    return <Context.Provider value={store}>{children}</Context.Provider>;
  }
  function useApi() {
    const store = useContext(Context);
    if (!store) throw new Error("UI domain provider is required");
    return store;
  }
  function useSelector<Value>(selector: (state: State) => Value) {
    return useStore(useApi(), selector);
  }
  function useOptionalApi() {
    return useContext(Context);
  }
  return { Provider, useApi, useSelector, useOptionalApi };
}
