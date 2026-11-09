import { useCallback, useEffect, useState } from "react";
import type { AccountPasskeyDto } from "@hey-hey/contracts/api/models";
import {
  addAccountPasskey,
  listAccountPasskeys,
  removeAccountPasskey,
  renameAccountPasskey,
  type AccountProofInput,
} from "../../services/accountPasskeys";

export interface UseAccountPasskeysReturn {
  passkeys: AccountPasskeyDto[] | null;
  loadError: string | null;
  add: (name: string, proof: AccountProofInput) => Promise<void>;
  rename: (passkeyId: string, name: string) => Promise<void>;
  remove: (passkeyId: string, proof: AccountProofInput) => Promise<void>;
}

/** The signed-in account's own passkeys, reloaded after every change. */
export function useAccountPasskeys(): UseAccountPasskeysReturn {
  const [passkeys, setPasskeys] = useState<AccountPasskeyDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPasskeys(await listAccountPasskeys());
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load passkeys",
      );
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (name: string, proof: AccountProofInput) => {
      await addAccountPasskey(name, proof);
      await reload();
    },
    [reload],
  );

  const rename = useCallback(
    async (passkeyId: string, name: string) => {
      await renameAccountPasskey(passkeyId, name);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (passkeyId: string, proof: AccountProofInput) => {
      await removeAccountPasskey(passkeyId, proof);
      await reload();
    },
    [reload],
  );

  return { passkeys, loadError, add, rename, remove };
}
