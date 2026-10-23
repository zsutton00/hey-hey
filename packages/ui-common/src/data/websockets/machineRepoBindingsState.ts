import { atom } from "jotai/vanilla";
import type { ServiceRepoBinding } from "../../api";

export type { ServiceRepoBinding };

// Latest repo bindings reported by each host machine, keyed by machineId. Repo
// bindings are machine state (set during the host's CLI setup), not conversation
// state, so the key is the machine that owns them. Populated from
// `machine.repo_bindings` websocket frames. An empty array means the machine is
// known but reported no bindings (or disconnected); an absent key means no frame
// has been received for that machine yet.
export const machineRepoBindingsByMachineAtom = atom<
  Record<string, ServiceRepoBinding[]>
>({});
