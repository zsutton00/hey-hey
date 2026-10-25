import React from "react";
import { useModal } from "@hey-hey/ui-common/context";
import { ModalWorkOwner } from "@hey-hey/ui-common/components/Modals";
import { HeyHeyModalInstance } from "./HeyHeyModalInstance";

/** Each configuration owns its mounted content until its own accepted close. */
export function HeyHeyModal(): React.ReactElement | null {
  const context = useModal();
  if (!context) return null;
  return (
    <>
      {context.modalInstances.map((instance) => (
        <ModalWorkOwner.Provider key={instance.id} value={instance.id}>
          <HeyHeyModalInstance
            currentModal={instance.config}
            closeModal={() => context.closeModal(instance.id)}
          />
        </ModalWorkOwner.Provider>
      ))}
    </>
  );
}
