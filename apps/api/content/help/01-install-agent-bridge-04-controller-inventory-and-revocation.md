---
id: 10000000-0000-4000-8000-000000000005
slug: controller-inventory-and-revocation
title: Controller inventory and revocation
parentId: 10000000-0000-4000-8000-000000000001
ordering: 4
demos: []
---
The controller inventory identifies the paired machine, authorization protocol, execution readiness, controller labels, fingerprints, creation and last-use times, backup flags, and revocation state. Revoke one controller when that credential or its passkey ecosystem should no longer authorize this machine. Revocation removes that controller from future authorization and grant admission; it does not revoke the machine itself. Use the exact local machine for local inspection and reconciliation when the CLI asks for machine proof.
