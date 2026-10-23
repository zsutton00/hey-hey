---
id: 10000000-0000-4000-8000-000000000009
slug: passkey-backup-and-synchronization
title: Passkey backup and synchronization
parentId: 10000000-0000-4000-8000-000000000001
ordering: 8
demos: []
---
A controller is a WebAuthn passkey credential, and synced passkeys are allowed. The inventory reports backup eligibility and backup state as evidence; those flags do not prove that a credential belongs to one physical device. A synchronized passkey may be available on more than one device, but it still authorizes only the enrolled machine and the exact action checks described here. If the passkey ecosystem is lost, use the exact local machine for a new enrollment; account-only or website-only restoration is not supported.
