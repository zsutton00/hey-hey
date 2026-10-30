import { useLayoutEffect, type ReactNode } from "react";
import { ModalProvider, useModal } from "../contexts/ModalContext";
import { HostedModalBoundary } from "../components/Modals/HostedModalBoundary";

function Host({ children }: { children: ReactNode }) {
  const modal = useModal();
  useLayoutEffect(() => {
    modal?.openModal({
      type: "triage",
      organizationId: "org",
      projectId: "project",
    });
  }, [modal?.openModal]);
  const instance = modal?.modalInstances[0];
  return instance ? (
    <HostedModalBoundary instanceId={instance.id}>
      {children}
    </HostedModalBoundary>
  ) : null;
}
/** Explicit independently owned opening boundary for isolated consumer/shell tests. */
export function HostedModalFixture({ children }: { children: ReactNode }) {
  return (
    <ModalProvider>
      <Host>{children}</Host>
    </ModalProvider>
  );
}
