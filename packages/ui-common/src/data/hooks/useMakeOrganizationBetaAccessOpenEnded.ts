import axios from "axios";
import type { AccountEntitlementDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { MutationOptions, MutationResult } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export type OrganizationEntitlementMutationFailure =
  | "authorization"
  | "conflict"
  | "ineligible"
  | "irreversible-closure"
  | "unknown";

export class OrganizationEntitlementMutationError extends Error {
  constructor(
    public readonly failure: OrganizationEntitlementMutationFailure,
    message: string
  ) {
    super(message);
    this.name = "OrganizationEntitlementMutationError";
  }
}

export interface MakeOrganizationBetaAccessOpenEndedVariables {
  organizationId: string;
  expectedRevision: number;
  reason: string;
}

export type UseMakeOrganizationBetaAccessOpenEndedOptions =
  MutationOptions<AccountEntitlementDto>;

const failureFor = (status: number | undefined, message: string) => {
  if (status === 401 || status === 403) return "authorization" as const;
  if (status === 400) return "ineligible" as const;
  if (status === 409 && /clos/i.test(message))
    return "irreversible-closure" as const;
  if (status === 409) return "conflict" as const;
  return "unknown" as const;
};

export function useMakeOrganizationBetaAccessOpenEnded(
  options: UseMakeOrganizationBetaAccessOpenEndedOptions = {}
): MutationResult<
  MakeOrganizationBetaAccessOpenEndedVariables,
  AccountEntitlementDto
> {
  const mutationFn = async ({
    organizationId,
    expectedRevision,
    reason,
  }: MakeOrganizationBetaAccessOpenEndedVariables) => {
    try {
      const response =
        await unifiedApiClient.makeOrganizationBetaAccessOpenEnded({
          organizationId,
          makeBetaAccessOpenEndedRequestDto: { expectedRevision, reason },
        });
      return response.data.data;
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;
      const body = error.response?.data as { message?: string } | undefined;
      const message = body?.message ?? "The entitlement could not be updated.";
      throw new OrganizationEntitlementMutationError(
        failureFor(error.response?.status, message),
        message
      );
    }
  };

  return useMutation(mutationFn, options);
}
