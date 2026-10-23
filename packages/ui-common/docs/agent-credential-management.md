# Agent Credential Management

This package provides a secure credential subsystem for Node-based coding agent adapters (`claude`, `codex`).

## Storage Model

The credential manager supports two storage backends:

1. OS keyring backend (`KeyringCredentialStorage`)
- Uses native OS secret storage through `keytar` when available.
- Supported platforms: macOS Keychain, Windows Credential Manager, Linux Secret Service (via keytar).

2. Encrypted file backend (`EncryptedFileCredentialStorage`)
- Uses AES-256-GCM at rest.
- Encryption key is derived via `scrypt` from:
  - a caller-provided passphrase, or
  - machine-bound material + a local machine secret file.

Backend selection defaults to `auto` via `createCredentialStorage()`:
- Keyring first.
- Encrypted file fallback if keyring is unavailable.

## Default Locations

By default, files live under:

- `~/.heyhey/credentials/`
  - `keyring/index.json` (metadata index only)
  - `encrypted/` (AES-encrypted credential blobs + metadata index)
- `~/.heyhey/sessions/`
  - Session metadata including `credentialLifecycle`

Set `HEYHEY_HOME_DIR` to relocate all storage.

## Credential API

`CredentialManager` is the single source of truth for adapter auth.

- `getCredential(agentType, accountId, options?)`
- `storeCredential(agentType, credential)`
- `listCredentials(agentType?)`
- `deleteCredential(agentType, accountId)`
- `clearAllCredentials()`
- `subscribe(listener)` for lifecycle events (`stored`, `refreshed`, `deleted`)

Refresh behavior:
- Automatic on `getCredential` when token is near expiry.
- Exponential backoff retries.
- Typed errors:
  - `INVALID_CREDENTIAL`
  - `REFRESH_FAILED`
  - `RATE_LIMITED`

## CLI Command Helpers

Use `runCredentialCommand()` with:

- `add-credential`
- `list-credentials`
- `remove-credential`

Secret entry uses hidden interactive prompts (`promptSecret`) so secrets are never placed in shell history and are not echoed.

## Adapter Integration

`ClaudeCodeAdapter` and `CodexAdapter` support `credentialBinding` in config:

- Fetches fresh credentials from `CredentialManager` at invocation time.
- Injects auth env vars into spawned agent process.
- Subscribes to manager refresh/store/delete events.

When credential binding is configured, `NodeAgentClient` defaults session persistence to filesystem (`FileSystemAgentSessionStore`) and includes credential lifecycle metadata in session records.

## Token Rotation Procedures

Recommended rotation workflow:

1. Add replacement credential (`add-credential`) for the same account.
2. Validate by running one agent invocation.
3. Remove old credential (`remove-credential`).
4. If needed, force refresh by calling `getCredential(..., { forceRefresh: true })`.

## Logout and Data Wipe

On logout, call `clearCredentialStateOnLogout({ manager })` to:

- Clear all stored credentials.
- Remove `~/.heyhey/sessions/` files (unless disabled).

## Security Notes

- Credentials are encrypted at rest in fallback mode using AES-256-GCM.
- Sensitive files are written with restrictive permissions (`0700` directories, `0600` files where supported).
- Credential list output only exposes metadata (agent, account, scopes, expiration), never tokens.
