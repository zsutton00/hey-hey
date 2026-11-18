---
id: 10000000-0000-4000-8000-000000000012
slug: protected-credential-store-failures
title: Protected credential-store failures
parentId: 10000000-0000-4000-8000-000000000001
ordering: 11
demos: []
---

Agent Bridge stores machine secrets and the local integrity key in the operating-system protected credential store. If that store is unavailable, unreadable, or cannot protect the required state, the CLI does not invent a fallback, accept an account token as authority, or continue with unverified local data. Stop on the exact local machine, restore its protected credential store, and rerun the local enrollment or reconciliation flow. A website session cannot repair a missing local secret.

Never delete credentials, keyrings, or keychains to get past this error. The CLI never writes secrets in plaintext, so the stored data is what lets the same installation keep working once the store is reachable again. Repair the store, then run `heyhey local` again; nothing needs to be reinstalled.

## Linux

`heyhey local` needs a running Secret Service provider with a default collection that is unlocked. The error code `DEFAULT_COLLECTION_MISSING` means a provider answered but no default collection exists; `PLATFORM_UNAVAILABLE` usually means no provider is reachable at all.

1. Confirm a Secret Service provider is installed and running in your login session, for example GNOME Keyring (Seahorse, "Passwords and Keys") or KeePassXC with its Secret Service integration enabled. Only one provider should own the Secret Service name.
2. Confirm the session message bus is reachable from the terminal where you run `heyhey local`: `echo "$DBUS_SESSION_BUS_ADDRESS"` should print an address. Over SSH or inside a container the variable is often empty; run from a graphical login session instead.
3. Confirm a default collection exists and is unlocked. In Seahorse, create a "Login" keyring if none exists, set it as the default, and unlock it. In KeePassXC, expose a database as the Secret Service collection and unlock it.
4. Run `heyhey local` again.

## macOS

The CLI uses the login Keychain. If the login Keychain is locked or missing, open Keychain Access, unlock "login" (or choose File > Unlock Keychain), and make sure it is the default keychain. If macOS prompts for access for the `node` program, allow it. Do not delete the "login" keychain or entries starting with `heyhey`.

## Windows

The CLI uses Windows Credential Manager. Confirm you are signed in as the same Windows user that first ran `heyhey local`, and that Credential Manager opens under "Windows Credentials". A service account or a different user cannot read another user's entries. Do not remove entries starting with `heyhey`.

## Still failing

Run `heyhey local troubleshoot` to print a ready-to-use troubleshooting prompt for the newest failed attempt. It names the safe error code and the saved diagnostic files, and you can give it to your own coding agent. See also Local startup troubleshooting.
