import { createContext, useContext } from "react";

export interface FutureOfferContextValue {
  /** Queues the offer for a task; resolves once that offer has been resolved or dismissed. */
  checkTask: (taskId: string) => Promise<void> | void;
}
export const FutureOfferContext = createContext<FutureOfferContextValue | null>(
  null,
);
export const useFutureOffers = () => useContext(FutureOfferContext);
