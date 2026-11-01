import React from "react";
import {
  useModal,
  copyPersistentModalRequest,
} from "@hey-hey/ui-common/context";
import { HostedModalBoundary } from "@hey-hey/ui-common/components/Modals";
import { HeyHeyModalInstance } from "./HeyHeyModalInstance";
import { HostedModalInstance } from "./HostedModalInstance";

/** The application owns each content tree until its consumer accepts close. */
export function HeyHeyModal(): React.ReactElement | null {
  const context = useModal();
  if (!context) return null;
  return (
    <>
      {context.modalInstances.map((instance) => {
        const request = copyPersistentModalRequest(instance.config);
        const close = () => context.closeModal(instance.id);
        if (request)
          return (
            <HostedModalBoundary key={instance.id} instanceId={instance.id}>
              <HostedModalInstance
                request={request}
                instanceId={instance.id}
                onClose={close}
              />
            </HostedModalBoundary>
          );
        return instance.config.type !== "discuss" &&
          instance.config.type !== "triage" &&
          instance.config.type !== "preview" ? (
          <HeyHeyModalInstance
            key={instance.id}
            currentModal={instance.config}
            closeModal={close}
          />
        ) : null;
      })}
    </>
  );
}
