import { useAtomValue } from "jotai";
import { machineRepoBindingsByMachineAtom } from "../websockets/machineRepoBindingsState";
import type { ServiceRepoBinding } from "../websockets/machineRepoBindingsState";

// Repo bindings reported by `machineId` over the platform `machine.repo_bindings`
// feed. Returns `null` when no frame has arrived yet (still loading / unknown
// machine), or the (possibly empty) binding array once that machine has
// reported. Repo bindings are machine state, so they are addressed by machine.
export function useMachineRepoBindings(
  machineId: string | null | undefined
): ServiceRepoBinding[] | null {
  const bindingsByMachine = useAtomValue(machineRepoBindingsByMachineAtom);
  if (!machineId) return null;
  return bindingsByMachine[machineId] ?? null;
}
