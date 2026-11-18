# Rehearse packaged first use

In a bootstrapped checkout run `apps/cli/scripts/reset-local-macos.sh` on macOS or `apps/cli/scripts/reset-local-linux.sh` on Linux. Exit local CLI terminals first. Use a disposable OS login and a dedicated local Docker daemon. The packaged and development commands share this installation. Reset permanently erases projects, setup, server-side passkey registrations, and server-side session state. Use Repair for data-preserving re-pairing.

Choose whether to erase the dedicated machine keyring entries and local OAuth credential files. Review the local installation directory, Docker context, and individual targets before typing the confirmation. If an operation fails, correct the reported cause and rerun to inventory what remains. Images, build caches, npm downloads and the downloaded embedding model survive. This exercises fresh application state. Use a new VM and empty Docker daemon to test cold downloads.

## Browser and authenticator

Use a dedicated browser profile and record the browser, profile, localhost port, authenticator and test account at enrollment. For a new browser session, open a fresh profile. To clear the test profile's localhost cookies in Chrome, open Settings → Privacy and security → Third-party cookies → See all site data and permissions, search for localhost and delete that site's data. This can affect other localhost apps in that profile.

To remove an authenticator credential, open the manager used at enrollment. In Apple Passwords choose Passkeys, open the matching localhost test account, choose Edit and delete its passkey. In Chrome open Google Password Manager, search for localhost, open the matching test account and delete its passkey. For a YubiKey open Yubico Authenticator → Passkeys, unlock with the key PIN, select the matching localhost account and delete that credential. Confirm the specific entry disappears. Synced deletion can propagate to other devices. If the provider cannot identify or delete an individual credential, record it as retained and use a separate test authenticator.

## Verification on each OS

1. Populate the packaged installation with a project and a recognizable work item. Record the project identity, machine identity, browser and authenticator. Establish independent test sentinels for hosted, development, legacy localhost and unrelated keyring entries, and an unrelated Docker container and volume.
2. Reset with credentials retained. Restart the installed `heyhey local`. Confirm the name prompt, one new empty default project, recovery from the stale machine identity, pairing, terms and setup completion on that same project. Verify a host action with controller proof. Exit and return with the same profile and verify the same workspace. Check all independent sentinels still work.
3. Populate again and repeat with credential cleanup enabled. Verify the dedicated entries disappeared before restarting. Record which browser cookies and authenticator entries survived, perform the desired manual cleanup, then repeat first use, return and preservation checks.
