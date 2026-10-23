---
id: 10000000-0000-4000-8000-000000000008
slug: protocol-version-2-upgrade
title: Upgrade to protocol version 2
parentId: 10000000-0000-4000-8000-000000000001
ordering: 7
demos: []
---
Protocol version 2 is the controller-authorized execution path. Existing machines may remain visible and revocable during upgrade, but a legacy protocol machine is not execution-ready and must complete local controller enrollment before it can receive host-affecting work. Upgrade the CLI on the exact machine, run its local enrollment flow, create or select the browser passkey, and complete the machine confirmation. The platform does not downgrade a version-2 request to a legacy envelope or convert a machine through the website alone.
