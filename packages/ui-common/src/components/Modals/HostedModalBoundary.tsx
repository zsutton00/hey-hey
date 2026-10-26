import { createContext, type ReactNode } from "react";
import { modalDomain } from "../../state/modalDomain";

export const HostedModalContext = createContext<string | null>(null);
/** The shared renderer supplies a real validated store instance, never an eligibility flag. */
export function HostedModalBoundary({
  instanceId,
  children,
}: {
  instanceId: string;
  children: ReactNode;
}) {
  const eligible = modalDomain.useSelector((state) =>
    state.instances.some((item) => item.id === instanceId && item.persistent),
  );
  return (
    <HostedModalContext.Provider value={eligible ? instanceId : null}>
      {children}
    </HostedModalContext.Provider>
  );
}
