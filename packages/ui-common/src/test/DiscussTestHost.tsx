import type { ReactNode } from "react";
import { ModalProvider, useModal } from "../contexts/ModalContext";
import { HostedDiscussOwner } from "../components/InteractionComponent/HostedDiscussOwner";
import { copyPersistentModalRequest } from "../contexts/types/persistentModalRequest";
export function TestDiscussHost() {
  const modal = useModal();
  return (
    <>
      {modal?.modalInstances.map((item) => {
        const request = copyPersistentModalRequest(item.config);
        return request?.type === "discuss" ? (
          <HostedDiscussOwner
            key={item.id}
            request={request}
            onClose={() => modal.closeModal(item.id)}
          />
        ) : null;
      })}
    </>
  );
}
export function DiscussTestApplication({ children }: { children: ReactNode }) {
  return (
    <ModalProvider>
      {children}
      <TestDiscussHost />
    </ModalProvider>
  );
}
