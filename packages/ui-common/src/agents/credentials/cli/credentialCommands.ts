import {
  SUPPORTED_AGENT_TYPES,
  toAgentAccountId,
  type AgentAccountId,
  type AgentType,
} from "../types";
import type { CredentialManager } from "../CredentialManager";
import type { CredentialPrompter } from "./interactivePrompt";
import { createInteractivePrompter } from "./interactivePrompt";

export type CredentialCliCommand =
  | "add-credential"
  | "list-credentials"
  | "remove-credential";

export interface CredentialCommandOptions {
  manager: CredentialManager;
  prompter?: CredentialPrompter;
  output?: NodeJS.WriteStream;
  now?: () => number;
}

interface ParsedArgs {
  agentType?: AgentType;
  accountId?: AgentAccountId;
  scopes?: string[];
  expiresAt?: number | null;
}

const isAgentType = (value: string): value is AgentType =>
  (SUPPORTED_AGENT_TYPES as readonly string[]).includes(value);

const parseScopes = (raw: string): string[] =>
  raw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

const parseArgs = (argv: readonly string[], now: () => number): ParsedArgs => {
  const result: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = index + 1 < argv.length ? argv[index + 1] : undefined;

    if ((argument === "--agent" || argument === "-a") && nextValue) {
      if (!isAgentType(nextValue)) {
        throw new Error(
          `Unsupported agent type "${nextValue}". Expected one of: ${SUPPORTED_AGENT_TYPES.join(
            ", "
          )}`
        );
      }

      result.agentType = nextValue;
      index += 1;
      continue;
    }

    if ((argument === "--account" || argument === "-u") && nextValue) {
      result.accountId = toAgentAccountId(nextValue);
      index += 1;
      continue;
    }

    if (argument === "--scopes" && nextValue) {
      result.scopes = parseScopes(nextValue);
      index += 1;
      continue;
    }

    if (argument === "--expires-at" && nextValue) {
      const parsed = Number(nextValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --expires-at value: ${nextValue}`);
      }
      result.expiresAt = Math.round(parsed);
      index += 1;
      continue;
    }

    if (argument === "--expires-in" && nextValue) {
      const parsedSeconds = Number(nextValue);
      if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
        throw new Error(`Invalid --expires-in value: ${nextValue}`);
      }
      result.expiresAt = now() + Math.round(parsedSeconds * 1_000);
      index += 1;
      continue;
    }
  }

  return result;
};

const writeLine = (output: NodeJS.WriteStream, message: string): void => {
  output.write(`${message}\n`);
};

const ensureAgentType = async (
  parsedArgs: ParsedArgs,
  prompter: CredentialPrompter
): Promise<AgentType> => {
  if (parsedArgs.agentType) {
    return parsedArgs.agentType;
  }

  const answer = (
    await prompter.prompt(`Agent type (${SUPPORTED_AGENT_TYPES.join("/")}): `)
  ).trim();
  if (!isAgentType(answer)) {
    throw new Error(`Invalid agent type: ${answer}`);
  }

  return answer;
};

const ensureAccountId = async (
  parsedArgs: ParsedArgs,
  prompter: CredentialPrompter
): Promise<AgentAccountId> => {
  if (parsedArgs.accountId) {
    return parsedArgs.accountId;
  }

  const answer = await prompter.prompt("Account id: ");
  if (answer.trim().length === 0) {
    throw new Error("Account id is required");
  }

  return toAgentAccountId(answer.trim());
};

const formatExpiry = (expiresAt: number | null): string => {
  if (expiresAt === null) {
    return "never";
  }

  return new Date(expiresAt).toISOString();
};

const removeCredential = async (
  args: readonly string[],
  options: CredentialCommandOptions
): Promise<void> => {
  const prompter = options.prompter ?? createInteractivePrompter();
  const now = options.now ?? (() => Date.now());
  const parsedArgs = parseArgs(args, now);
  const agentType = await ensureAgentType(parsedArgs, prompter);

  let accountId = parsedArgs.accountId;
  if (!accountId) {
    const credentials = await options.manager.listCredentials(agentType);
    if (credentials.length === 0) {
      writeLine(
        options.output ?? process.stdout,
        `No ${agentType} credentials found.`
      );
      return;
    }

    const listing = credentials
      .map((credential, index) => `${index + 1}. ${credential.accountId}`)
      .join("\n");
    writeLine(options.output ?? process.stdout, listing);

    const selected = await prompter.prompt(
      "Select credential number to remove: "
    );
    const numeric = Number(selected);
    if (
      !Number.isFinite(numeric) ||
      numeric < 1 ||
      numeric > credentials.length
    ) {
      throw new Error(`Invalid credential selection: ${selected}`);
    }

    accountId = credentials[numeric - 1].accountId;
  }

  const confirmed = await prompter.confirm(
    `Remove ${agentType} credential for account ${accountId}?`,
    false
  );

  if (!confirmed) {
    writeLine(options.output ?? process.stdout, "Credential removal canceled.");
    return;
  }

  const deleted = await options.manager.deleteCredential(agentType, accountId);
  if (deleted) {
    writeLine(
      options.output ?? process.stdout,
      `Removed ${agentType} credential for account ${accountId}.`
    );
    return;
  }

  writeLine(
    options.output ?? process.stdout,
    `No ${agentType} credential found for account ${accountId}.`
  );
};

const addCredential = async (
  args: readonly string[],
  options: CredentialCommandOptions
): Promise<void> => {
  const prompter = options.prompter ?? createInteractivePrompter();
  const now = options.now ?? (() => Date.now());
  const parsedArgs = parseArgs(args, now);

  const agentType = await ensureAgentType(parsedArgs, prompter);
  const accountId = await ensureAccountId(parsedArgs, prompter);

  const accessToken = await prompter.promptSecret("Access token: ");
  if (accessToken.trim().length === 0) {
    throw new Error("Access token is required");
  }

  const refreshTokenInput = await prompter.promptSecret(
    "Refresh token (optional): "
  );

  const idTokenInput = await prompter.promptSecret("ID token (optional): ");
  const tokenTypeInput = await prompter.prompt("Token type (optional): ");

  const scopes =
    parsedArgs.scopes ??
    parseScopes(await prompter.prompt("Scopes (comma-separated, optional): "));

  let expiresAt = parsedArgs.expiresAt;
  if (expiresAt === undefined) {
    const expiresAtInput = await prompter.prompt(
      "Expires in seconds (optional, blank for no expiration): "
    );

    if (expiresAtInput.trim().length === 0) {
      expiresAt = null;
    } else {
      const expiresInSeconds = Number(expiresAtInput);
      if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new Error(`Invalid expiration value: ${expiresAtInput}`);
      }
      expiresAt = now() + Math.round(expiresInSeconds * 1_000);
    }
  }

  await options.manager.storeCredential(agentType, {
    accountId,
    accessToken,
    refreshToken:
      refreshTokenInput.trim().length > 0 ? refreshTokenInput : null,
    idToken: idTokenInput.trim().length > 0 ? idTokenInput : null,
    tokenType: tokenTypeInput.trim().length > 0 ? tokenTypeInput : null,
    scopes,
    expiresAt,
  });

  writeLine(
    options.output ?? process.stdout,
    `Stored ${agentType} credential for account ${accountId}.`
  );
};

const listCredentials = async (
  args: readonly string[],
  options: CredentialCommandOptions
): Promise<void> => {
  const now = options.now ?? (() => Date.now());
  const parsedArgs = parseArgs(args, now);
  const credentials = await options.manager.listCredentials(
    parsedArgs.agentType
  );

  if (credentials.length === 0) {
    writeLine(options.output ?? process.stdout, "No credentials found.");
    return;
  }

  for (const credential of credentials) {
    writeLine(
      options.output ?? process.stdout,
      [
        `agent=${credential.agentType}`,
        `account=${credential.accountId}`,
        `expires=${formatExpiry(credential.expiresAt)}`,
        `scopes=${credential.scopes.join(" ") || "none"}`,
      ].join(" ")
    );
  }
};

export const runCredentialCommand = async (
  command: CredentialCliCommand,
  args: readonly string[],
  options: CredentialCommandOptions
): Promise<void> => {
  if (command === "add-credential") {
    await addCredential(args, options);
    return;
  }

  if (command === "list-credentials") {
    await listCredentials(args, options);
    return;
  }

  await removeCredential(args, options);
};
