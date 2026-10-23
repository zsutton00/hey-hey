# Credential Storage

Two stores, two storage backends, by design:

## OAuth tokens — encrypted file store

`CredentialStore` is the concrete owner for OAuth access/refresh tokens read on every CLI startup. It is backed by AES-256-GCM encrypted files under the user's app-support directory — never the OS keychain. Goal: zero keychain prompts during normal CLI use.

- `store(key, credential)` writes access + refresh as separate encrypted files
- `retrieve(key)` returns `{ accessToken, refreshToken, expiresAt, scope, tokenType, issuedAt } | null`
- `update(key, credential)` behaves like `store`
- `delete(key)` securely overwrites and removes both files

Schema

- Access payload: `{ accessToken, expiresAt, scope?, tokenType?, issuedAt? }`
- Refresh payload: `{ refreshToken, issuedAt? }`

Security

- AES-256-GCM with a PBKDF2-derived key (310k iterations, SHA-256)
- PBKDF2 input is derived from user + host identifiers (best-effort device binding)
- Files live in user-only directories, 0700 directory mode, 0600 file mode
- On delete, files are overwritten with random bytes before unlinking
- Errors: `StorageFailureError`, `CorruptedDataError`, `SerializationError`

## Ed25519 signing keypair — OS keychain

`KeyPairStore` (see `keypair.ts`) owns the pairing private key and pending
enrollment secret. It uses `@napi-rs/keyring` (Keychain Services on macOS,
Credential Manager on Windows, Secret Service on Linux), or the explicitly
selected encrypted file backend. Production does not silently fall back when
the protected backend is unavailable.

- `generateMachineKeyPair()` creates an Ed25519 keypair without persistence.
- `storePrivateKey(machineId, privateKeyPem)` persists the PKCS8 PEM under
  `heyhey-cli/<machineId>/private_key`.
- `storePendingEnrollmentSecret(enrollmentId, deviceSecret)` and its load/delete
  counterparts persist the one-time secret under the enrollment ID.
- `setCurrentMachineId(machineId)` remains the explicit promotion operation and
  is not called by the enrollment-opening command.
- `loadPrivateKey(machineId)` / `loadCurrentMachineId()` read them back
- Errors: `PermissionDeniedError`, `PlatformUnavailableError`, `StorageFailureError`
