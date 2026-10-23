---
id: 10000000-0000-4000-8000-000000000010
slug: authorization-denials
title: When authorization is denied
parentId: 10000000-0000-4000-8000-000000000001
ordering: 9
demos: []
---
A request can be denied when the machine is not ready, the controller is inactive or revoked, the protocol is not version 2, the authorization is missing or expired, the action or target does not match, the payload hash changed, or the assertion was replayed. Denial is fail-closed: the CLI must not execute, acknowledge, or widen the work. Read the reason shown by the CLI, correct the local state if needed, and obtain a fresh approval for the unchanged intended action.
