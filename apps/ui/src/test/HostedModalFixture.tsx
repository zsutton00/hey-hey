import { useLayoutEffect, type ReactNode } from "react";
import { ModalProvider, useModal } from "@hey-hey/ui-common/context";
import { HostedModalBoundary } from "@hey-hey/ui-common/components/Modals";
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
export function HostedModalFixture({ children }: { children: ReactNode }) {
  return (
    <ModalProvider>
      <Host>{children}</Host>
    </ModalProvider>
  );
}
