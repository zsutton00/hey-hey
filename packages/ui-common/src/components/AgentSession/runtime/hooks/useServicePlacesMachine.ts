import { useMemo } from "react";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";

/**
 * The machine that places are read from. It keeps its identity while only its
 * heartbeat changes, so a routine refresh of the machine list neither re-reads
 * places nor closes an open branch name field.
 */
export const useServicePlacesMachine = (
  machineId: string,
  enabled: boolean,
) => {
  const machinesQuery = useUserPairedMachines({ enabled });
  const found = machinesQuery.machines.find(
    (candidate) => candidate.machineId === machineId,
  );
  const identity = found ? JSON.stringify({ ...found, lastSeen: null }) : null;
  // `identity` stands in for the machine object, minus its heartbeat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const machine = useMemo(() => found, [identity]);

  return { machinesQuery, machine };
};
