import { createContext, useContext, useLayoutEffect } from "react";

export const DataStateLoadingContext = createContext<
  ((token: symbol) => () => void) | null
>(null);

/** Register pending work with the nearest page presentation owner. */
export const useDataStateLoading = (pending: boolean): boolean => {
  const register = useContext(DataStateLoadingContext);
  useLayoutEffect(() => {
    if (pending && register) return register(Symbol());
  }, [pending, register]);
  return register !== null;
};
