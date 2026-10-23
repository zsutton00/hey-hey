GitHub OAuth Service

Overview
- The OAuth flow is anchored by two controller endpoints:
  - GET /api/v1/organizations/:organizationId/projects/:projectId/integrations/github/authorize
  - GET /api/v1/organizations/:organizationId/projects/:projectId/integrations/github/callback
- The authorization endpoint validates the integration, builds a signed state payload, and redirects to GitHub with scope=repo.
- The callback endpoint exchanges the code for tokens, stores them on the integration config, and redirects back to the app.

Environment
- GITHUB_CLIENT_ID: OAuth app client id.
- GITHUB_CLIENT_SECRET: OAuth app client secret (also used to sign state).
- API_BASE_URL: Used to build the callback URL.
- APP_BASE_URL: Used to redirect back to the UI after success.

State
- The state payload includes integrationId, organizationId, projectId, a nonce, and issuedAt.
- The payload is base64url encoded and HMAC-signed with GITHUB_CLIENT_SECRET.
- State expires after 10 minutes to limit replay attempts.

Token handling
- Access and refresh tokens are stored in Integration.config.
- Sensitive fields are encrypted at rest via ConfigEncryptionService.
- API responses mask sensitive fields, while findOneWithDecryptedConfig returns decrypted tokens for internal use.
- Refresh tokens are used to renew access tokens when expired in integration workflows (sync, connection test).

Failure behavior
- OAuth errors update integration connectionStatus to ERROR with the error message.
- Invalid/expired state results in 400 responses, and no tokens are stored.
