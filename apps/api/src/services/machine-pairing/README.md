# Staging passkey configuration

Staging runs with `NODE_ENV=production`, but must verify passkeys against its
own browser origin. Configure both API environment variables:

```env
MACHINE_ENROLLMENT_WEBAUTHN_RP_ID=staging.heyhey.dev
MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN=https://staging.heyhey.dev
```

The staging Compose override in the deploy repository derives both values from
`STAGING_DOMAIN`. Deploy an API image containing the configuration resolver fix
along with that override, then start a fresh CLI enrollment.

Explicit configuration takes precedence in every runtime mode and requires both
values. Partial or empty configuration fails startup. When neither variable is
set, production runtime mode retains `heyhey.dev` and `https://heyhey.dev`.
Other runtime modes continue to require explicit configuration.

The resolver is shared by enrollment and controller authorization. An origin
mismatch during enrollment verification currently surfaces as
`MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE`; refreshing the browser does not repair
the server configuration.
