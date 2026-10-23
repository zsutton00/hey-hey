import { z } from "zod";
import {
  SUPPORTED_AGENT_TYPES,
  toAgentAccountId,
  type AgentCredentialMetadata,
  type AgentCredentialRecord,
} from "../types";

const agentTypeSchema = z.enum(SUPPORTED_AGENT_TYPES);

const credentialSchema = z.object({
  agentType: agentTypeSchema,
  accountId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  idToken: z.string().nullable(),
  tokenType: z.string().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const metadataSchema = credentialSchema.pick({
  agentType: true,
  accountId: true,
  scopes: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
});

export const parseCredentialRecord = (
  value: unknown,
): AgentCredentialRecord => {
  const parsed = credentialSchema.parse(value);
  return {
    ...parsed,
    accountId: toAgentAccountId(parsed.accountId),
  };
};

export const parseCredentialMetadata = (
  value: unknown,
): AgentCredentialMetadata => {
  const parsed = metadataSchema.parse(value);
  return {
    ...parsed,
    accountId: toAgentAccountId(parsed.accountId),
  };
};
