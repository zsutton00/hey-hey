# Hey Hey OAuth Client

TypeScript OAuth client library for authenticating with Hey Hey API using Authorization Code flow.

## Features

- **OAuth Authorization Code Flow** with local callback server
- **Automatic token refresh** (30-second skew before expiration)
- **Secure token storage** using platform-native credential stores (Keychain, Credential Manager, Secret Service)
- **Encrypted fallback** to local file when platform stores unavailable
- **Browser integration** automatically opens authorization URL
- **Type-safe API** with result objects instead of exceptions

## Installation

```typescript
import { OAuthClient } from './auth';
```

## Usage

### Basic Authentication Flow

```typescript
import { OAuthClient } from './auth';

const client = new OAuthClient();

// Login - opens browser and waits for authorization
const loginResult = await client.login();
if (!loginResult.success) {
  console.error('Login failed:', loginResult.error);
  process.exit(1);
}
console.log('Successfully authenticated!');

// Check authentication status
const isAuth = await client.isAuthenticated();
console.log('Authenticated:', isAuth);

// Get access token (auto-refreshes if expired)
const tokenResult = await client.getAccessToken();
if (!tokenResult.success) {
  console.error('Failed to get token:', tokenResult.error);
  process.exit(1);
}
const token = tokenResult.data;

// Use token for API calls
const response = await fetch('http://localhost:3000/api/artifacts', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// Logout - revokes token and clears credentials
const logoutResult = await client.logout();
if (!logoutResult.success) {
  console.error('Logout failed:', logoutResult.error);
}
```

### Custom Configuration

```typescript
import { OAuthClient } from './auth';

const client = new OAuthClient({
  config: {
    baseUrl: 'https://api.heyhey.example',
    scopes: ['read', 'write', 'admin'],
    callbackPort: 8080, // Use specific port instead of random
    timeoutMs: 600_000, // 10 minutes instead of default 5
  },
});
```

### Non-Interactive Sign-In (injecting a pre-minted token)

Headless environments (CI, containers, remote agents) can skip the browser flow
entirely by injecting an already-minted access token. The result is a credential
**indistinguishable from the browser flow** — written to the same host+profile
key, read back by `OAuthClient` with no special-casing.

Two equivalent entry points:

```bash
# Flag form — writes the credential immediately and exits.
heyhey login --token <jwt> [--refresh-token <jwt>] [--expires-at <iso8601>]

# Env form — any command seeds the credential on startup if none is stored yet.
HEYHEY_ACCESS_TOKEN=<jwt> \
HEYHEY_REFRESH_TOKEN=<jwt> \        # optional
HEYHEY_TOKEN_EXPIRES_AT=<iso8601> \ # optional
heyhey status
```

The token is validated parse-only before anything is written (three JWT
segments, a header carrying `typ`/`alg`, a decodable payload, and a non-expired
`exp` when present). When `--expires-at` / `HEYHEY_TOKEN_EXPIRES_AT` is omitted,
the expiry is derived from the token's `exp` claim. When no refresh token is
supplied the credential is access-only, exactly as the browser flow stores it
when the server returns no refresh token.

The env-seed path **never overwrites** an existing credential — it only fills an
empty slot — whereas `login --token` is an explicit action that always writes.

### Machine Enrollment

`heyhey pair` starts a protocol-version-2 enrollment directly from the machine
that will run Hey Hey. It generates an Ed25519 key locally, opens the public
enrollment endpoint without reading an OAuth token, and displays the one-time
formatted code, expiry, machine details, allocated machine identity, and a
short public-key fingerprint for the browser flow.

After the browser claims the enrollment, the same command polls the generated
protocol-version-2 state, displays the exact controller evidence, and asks for
explicit local confirmation. `pair` reports success only after the generated
activation response has been durably promoted; a restart resumes protected
activation recovery without requesting another credential.

The private key is retained under the allocated machine ID and the one-time
device secret is retained under the enrollment ID in the protected,
backend/profile-isolated credential store until local confirmation succeeds.
The device secret and private key are never printed or logged.

### Using a Custom Credential Store

```typescript
import { OAuthClient } from './auth';
import { CredentialStore } from '../credentials/store';

const credentialStore = new CredentialStore();
const client = new OAuthClient({ credentialStore });
```

OAuth tokens are always written to the encrypted file store; the OS keychain is reserved for the pairing keypair (see `src/credentials/README.md`).

## Configuration

### Environment Variables

- `HEYHEY_API_URL` - Base URL for Hey Hey API (default: `http://localhost:3000`)

### Default Configuration

```typescript
{
  baseUrl: process.env.HEYHEY_API_URL || 'http://localhost:3000',
  clientId: 'heyhey-cli-placeholder',
  clientSecret: 'heyhey-secret-placeholder',
  scopes: ['read', 'write'],
  callbackPort: 0, // Random port
  timeoutMs: 300_000, // 5 minutes
}
```

## API Reference

### `new OAuthClient(options?: OAuthClientOptions)`

Creates a new OAuth client instance.

**Options:**

- `config?: Partial<OAuthConfig>` - Override default configuration
- `credentialStore?: CredentialStore` - Custom credential store implementation

### `OAuthClient`

#### `login(): Promise<OAuthResult<void>>`

Initiates OAuth flow:

1. Starts local callback server on `127.0.0.1:PORT`
2. Opens browser to authorization URL
3. Waits for callback with authorization code
4. Exchanges code for access/refresh tokens
5. Stores tokens in credential store

Returns result object with `success: true` or `success: false` with error message.

#### `logout(): Promise<OAuthResult<void>>`

Revokes access token and deletes credentials from store.

Returns result object with `success: true` or `success: false` with error message.

#### `getAccessToken(): Promise<OAuthResult<string>>`

Returns current access token, automatically refreshing if expired (within 30 seconds of expiration).

Returns:

- `{ success: true, data: string }` - Access token
- `{ success: false, error: string }` - Error message

#### `isAuthenticated(): Promise<boolean>`

Checks if user has stored credentials (does not validate token).

Returns `true` if credentials exist, `false` otherwise.

## Token Lifecycle

### Storage Format

Tokens are stored in the credential store under a host-keyed key, `heyhey:oauth:<host>`
(e.g. `heyhey:oauth:heyhey.dev` for prod, `heyhey:oauth:localhost:3000` under `--local`).
A `--profile <name>` adds a trailing `:<name>` segment — see [Profiles](#profiles):

```typescript
{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;      // ISO 8601 timestamp
  scope: string[];
  tokenType: 'Bearer';
}
```

An injected token (see [Non-Interactive Sign-In](#non-interactive-sign-in-injecting-a-pre-minted-token))
that supplies no refresh token is persisted access-only — the `:refresh` slot is
left empty, identical to a browser flow whose server returned no refresh token.

### Automatic Refresh

`getAccessToken()` checks if the token expires within 30 seconds and automatically refreshes if needed:

```typescript
// User calls getAccessToken()
const tokenResult = await client.getAccessToken();

// If token expires within 30 seconds:
// 1. Calls POST /api/oauth/token with refresh_token grant
// 2. Updates stored credentials with new tokens
// 3. Returns new access token

// Otherwise returns existing access token
```

### Storage Locations

Credentials are stored using platform-native credential stores with encrypted fallback
(examples below use the prod host key `heyhey:oauth:heyhey.dev`):

- **macOS**: Keychain (service: `heyhey-cli`, account: `heyhey:oauth:heyhey.dev:access`)
- **Windows**: Credential Manager (target: `heyhey-cli:heyhey:oauth:heyhey.dev:access`)
- **Linux**: Secret Service (label: `heyhey-cli:heyhey:oauth:heyhey.dev:access`)
- **Fallback**: `~/.heyhey-cli/credentials/heyhey:oauth:heyhey.dev.access.enc` (AES-256-GCM encrypted)

Access and refresh tokens are stored separately with `:access` and `:refresh` suffixes.

## Profiles

By default each backend host owns one set of OAuth credentials. Pass `--profile <name>`
(or set `HEYHEY_PROFILE=<name>`; the flag wins when both are present) to keep multiple
accounts on the _same_ backend disjoint — for example two test users on localhost.

### Key layout

The profile appends a trailing segment to the host-keyed credential key:

| Invocation                           | Credential key                    |
| ------------------------------------ | --------------------------------- |
| `heyhey login`                       | `heyhey:oauth:heyhey.dev`         |
| `heyhey login --local`               | `heyhey:oauth:localhost:3000`     |
| `heyhey login --profile e2e`         | `heyhey:oauth:heyhey.dev:e2e`     |
| `heyhey login --local --profile e2e` | `heyhey:oauth:localhost:3000:e2e` |

The pairing keypair store (`src/credentials/keypair.ts`) applies the same scoping to its
keychain accounts: a profile adds a trailing `<name>/` segment after the host namespace,
so prod becomes `<name>/...` and localhost becomes `localhost:3000/<name>/...`.

Non-interactive sign-in (`login --token` and the `HEYHEY_ACCESS_TOKEN` seed)
derives its key through the same helper the OAuth client uses, so `--profile` /
`HEYHEY_PROFILE` scopes an injected credential exactly as it scopes a browser
login — `heyhey login --token <jwt> --profile e2e` writes
`heyhey:oauth:heyhey.dev:e2e`.

### Backward compatibility

Running without a profile is unchanged — credentials keep their existing host-keyed keys,
so no re-login or re-pair is needed. Only profiled runs get the extra segment.

### Validation

Profile names are validated the same way as every credential key: non-empty, ≤255
characters, and free of null bytes, slashes, backslashes, and shell metacharacters
(`` ` $ ; | & < > ( ) ``). An invalid `--profile` exits non-zero before any work starts.

## Error Handling

All methods return `OAuthResult<T>` instead of throwing exceptions:

```typescript
type OAuthResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: unknown };
```

**Example:**

```typescript
const result = await client.getAccessToken();

if (!result.success) {
  console.error('Error:', result.error);
  if (result.details) {
    console.error('Details:', result.details);
  }
  return;
}

const token = result.data;
// Use token...
```

## OAuth Endpoints

The client expects the following OAuth 2.0 endpoints on the Hey Hey API:

- `GET /api/oauth/authorize` - Authorization endpoint
  - Query params: `response_type`, `client_id`, `redirect_uri`, `scope`, `state`

- `POST /api/oauth/token` - Token endpoint
  - Body params: `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`
  - Or: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`

- `POST /api/oauth/revoke` - Revocation endpoint
  - Body params: `token`, `client_id`, `client_secret`

## Testing

Run tests:

```bash
pnpm test src/auth
```

All tests use mocked credential stores and HTTP requests to avoid external dependencies.

## Security Considerations

1. **Client credentials** are currently hardcoded placeholders - these should be replaced with actual production values
2. **CSRF protection** via random `state` parameter validated on callback
3. **Tokens never logged** or exposed in error messages
4. **Platform-native storage** provides OS-level encryption and access control
5. **Fallback encryption** uses AES-256-GCM with PBKDF2 key derivation (600,000 iterations)
6. **Token refresh** happens transparently before expiration to avoid service interruption
7. **Callback server** binds to `127.0.0.1` only (not accessible from network)

## Examples

### CLI Tool Integration

```typescript
import { OAuthClient } from './auth';

async function main() {
  const client = new OAuthClient();

  // Check if already authenticated
  if (!(await client.isAuthenticated())) {
    console.log('Please login to continue...');
    const result = await client.login();
    if (!result.success) {
      console.error('Login failed:', result.error);
      process.exit(1);
    }
  }

  // Use authenticated client
  const tokenResult = await client.getAccessToken();
  if (!tokenResult.success) {
    console.error('Failed to get token:', tokenResult.error);
    process.exit(1);
  }

  console.log('Access token obtained:', tokenResult.data);
}

main();
```

### API Client Wrapper

```typescript
import { OAuthClient } from './auth';

export class HeyHeyApiClient {
  private oauthClient = new OAuthClient();

  async fetch(endpoint: string, options?: RequestInit) {
    const tokenResult = await this.oauthClient.getAccessToken();
    if (!tokenResult.success) {
      throw new Error(`Authentication failed: ${tokenResult.error}`);
    }

    return fetch(`${this.oauthClient.config.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${tokenResult.data}`,
      },
    });
  }

  async login() {
    return this.oauthClient.login();
  }

  async logout() {
    return this.oauthClient.logout();
  }
}
```
