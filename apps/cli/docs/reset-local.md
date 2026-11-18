# Rehearse packaged first use

In a bootstrapped checkout run `apps/cli/scripts/reset-local-macos.sh` on macOS or `apps/cli/scripts/reset-local-linux.sh` on Linux. Exit local CLI terminals first. Use a disposable OS login and a dedicated local Docker daemon. The reset covers both the installed `heyhey local` and the development workspace below, under one confirmation. Reset permanently erases projects, setup, server-side passkey registrations, and server-side session state. Use Repair for data-preserving re-pairing.

Choose whether to erase the dedicated machine keyring entries and local OAuth credential files. Review the local installation directory, Docker context, and individual targets before typing the confirmation. If an operation fails, correct the reported cause and rerun to inventory what remains. Images, build caches, npm downloads and the downloaded embedding model survive. This exercises fresh application state. Use a new VM and empty Docker daemon to test cold downloads.

## Development mode from a checkout

`pnpm --dir apps/cli dev:run local dev` runs the API and UI from source against pinned PostgreSQL, Redis and graph/search. It has its own workspace: the `~/.heyhey/local-dev` folder, the `heyhey-local-dev` Docker project and its volumes, and the `heyhey-local-dev-cli` keychain entries. The installed `heyhey local` keeps `~/.heyhey/local-application`, `heyhey-local` and `heyhey-local-cli`. Development data, pairing and checkout migrations never reach the installed app. Dev data and pairing carry between dev runs.

On first run the development workspace creates itself: the installation record and secrets, the embedding model, and the infrastructure images of the latest published release. It reads that release's manifest and installs nothing. Every run checks the pinned images and downloads only the missing ones, so an interrupted first download continues on the next run. Both use the same ports, so if the installed app is running, development mode exits and asks you to run `heyhey local stop` first.

After the full reset above, the next development run is a first install again.

`pnpm --dir apps/cli dev:run local dev --fresh` is the fast fresh start. It shows its targets and asks for the same `RESET heyhey-local` confirmation, then removes the containers, the database and Redis volumes, `cli/` and the dedicated machine keyring entries. It clears only the development workspace and keeps its installation record, secrets, images and model files, so `/local` opens at the name step without downloading again. The installed app's account and projects are untouched. Answering anything else cancels and exits normally. Browser cookies and authenticator passkeys need the manual cleanup below.

Dev-mode API and UI logs are in `~/.heyhey/local-dev/dev-logs/`.

Both apps serve the browser from the same localhost address, so a browser holds one session cookie for whichever ran last. When you switch between them, sign in again or use a separate browser profile for each.

## Browser and authenticator

Use a dedicated browser profile and record the browser, profile, localhost port, authenticator and test account at enrollment. For a new browser session, open a fresh profile. To clear the test profile's localhost cookies in Chrome, open Settings → Privacy and security → Third-party cookies → See all site data and permissions, search for localhost and delete that site's data. This can affect other localhost apps in that profile.

To remove an authenticator credential, open the manager used at enrollment. In Apple Passwords choose Passkeys, open the matching localhost test account, choose Edit and delete its passkey. In Chrome open Google Password Manager, search for localhost, open the matching test account and delete its passkey. For a YubiKey open Yubico Authenticator → Passkeys, unlock with the key PIN, select the matching localhost account and delete that credential. Confirm the specific entry disappears. Synced deletion can propagate to other devices. If the provider cannot identify or delete an individual credential, record it as retained and use a separate test authenticator.

## Verification on each OS

1. Populate the packaged installation with a project and a recognizable work item. Record the project identity, machine identity, browser and authenticator. Establish independent test sentinels for hosted, development, legacy localhost and unrelated keyring entries, and an unrelated Docker container and volume.
2. Reset with credentials retained. Restart the installed `heyhey local`. Confirm the name prompt, one new empty default project, recovery from the stale machine identity, pairing, terms and setup completion on that same project. Verify a host action with controller proof. Exit and return with the same profile and verify the same workspace. Check all independent sentinels still work.
3. Populate again and repeat with credential cleanup enabled. Verify the dedicated entries disappeared before restarting. Record which browser cookies and authenticator entries survived, perform the desired manual cleanup, then repeat first use, return and preservation checks.
