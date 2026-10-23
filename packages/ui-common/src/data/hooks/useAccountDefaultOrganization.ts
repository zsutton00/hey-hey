import { useCallback, useEffect, useRef, useState } from "react";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { accountDefaultOrganizationSchema } from "../../generated/browser-session-contract";
import type { AccountDefaultOrganizationDto } from "../../api";
import { apiClient } from "../../clients";

const validatePreference = addFormats(
  new Ajv()
).compile<AccountDefaultOrganizationDto>(accountDefaultOrganizationSchema);

export type AccountDefaultOrganizationState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready" | "saving" | "saved";
      preference: AccountDefaultOrganizationDto;
    }
  | {
      status: "save-error";
      preference: AccountDefaultOrganizationDto;
      message: string;
    };

export function useAccountDefaultOrganization(accountId: string | undefined) {
  const [result, setResult] = useState<{
    accountId: string | undefined;
    state: AccountDefaultOrganizationState;
  }>({ accountId, state: { status: "loading" } });
  const identity = useRef(accountId);
  identity.current = accountId;
  const version = useRef(0);
  const state: AccountDefaultOrganizationState =
    result.accountId === accountId ? result.state : { status: "loading" };

  const reload = useCallback(async () => {
    const requestVersion = ++version.current;
    setResult({ accountId, state: { status: "loading" } });
    if (!accountId) return;
    try {
      const response = await apiClient.getAccountDefaultOrganization();
      if (!validatePreference(response.data.data))
        throw new Error("Invalid account preference");
      if (
        identity.current === accountId &&
        version.current === requestVersion
      ) {
        setResult({
          accountId,
          state: { status: "ready", preference: response.data.data },
        });
      }
    } catch {
      if (
        identity.current === accountId &&
        version.current === requestVersion
      ) {
        setResult({
          accountId,
          state: {
            status: "error",
            message: "Unable to load your default organization.",
          },
        });
      }
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
    return () => {
      version.current++;
    };
  }, [reload]);

  const save = useCallback(
    async (organizationId: string) => {
      if (!accountId || !("preference" in state) || state.status === "saving")
        return;
      const requestVersion = ++version.current;
      const preference = state.preference;
      setResult({ accountId, state: { status: "saving", preference } });
      try {
        const response = await apiClient.setAccountDefaultOrganization({
          setAccountDefaultOrganizationDto: { organizationId },
        });
        if (
          !validatePreference(response.data.data) ||
          response.data.data.organizationId !== organizationId
        )
          throw new Error("Default was not confirmed");
        if (
          identity.current === accountId &&
          version.current === requestVersion
        ) {
          setResult({
            accountId,
            state: { status: "saved", preference: response.data.data },
          });
        }
      } catch {
        if (
          identity.current === accountId &&
          version.current === requestVersion
        ) {
          setResult({
            accountId,
            state: {
              status: "save-error",
              preference,
              message: "Unable to save your default organization. Try again.",
            },
          });
        }
      }
    },
    [accountId, state]
  );

  return { state, save, reload };
}
