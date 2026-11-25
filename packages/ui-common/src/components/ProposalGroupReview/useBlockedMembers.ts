import { createContext, useCallback, useState } from "react";

/** Members of the enclosing group that cannot be approved as shown. */
export const BlockedMembersContext = createContext<ReadonlySet<string>>(
  new Set(),
);

/** Tracks the members whose content reports that it cannot be shown. */
export function useBlockedMembers() {
  const [blockedMemberIds, setBlockedMemberIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const blockMember = useCallback((proposalId: string) => {
    setBlockedMemberIds((ids) => new Set([...ids, proposalId]));

    return () => {
      setBlockedMemberIds(
        (ids) => new Set([...ids].filter((id) => id !== proposalId)),
      );
    };
  }, []);

  return { blockedMemberIds, blockMember };
}
