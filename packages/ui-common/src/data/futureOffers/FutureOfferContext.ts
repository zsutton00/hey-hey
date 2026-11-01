import { createContext, useContext } from "react";

export interface FutureOfferContextValue {
  checkTask: (taskId: string) => void;
}
export const FutureOfferContext = createContext<FutureOfferContextValue | null>(
  null,
);
export const useFutureOffers = () => useContext(FutureOfferContext);
