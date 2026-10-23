---
id: 10000000-0000-4000-8000-000000000004
slug: additional-controllers
title: Add additional controllers
parentId: 10000000-0000-4000-8000-000000000001
ordering: 3
demos: []
---
To add another controller to a machine that is already paired, begin the enrollment from that exact local machine using the Agent Bridge CLI. The browser creates the additional native passkey, then the existing machine performs the local confirmation before the new controller becomes active. Each controller is a separate credential with its own label, evidence, and revocation state. Adding a passkey to an account on a different computer does not add authority to this machine.
