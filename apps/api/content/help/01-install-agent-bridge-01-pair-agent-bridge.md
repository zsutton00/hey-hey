---
id: 10000000-0000-4000-8000-000000000002
slug: pair-agent-bridge
title: Pair Agent Bridge from the CLI
parentId: 10000000-0000-4000-8000-000000000001
ordering: 1
demos: []
---
Pairing begins on the exact local machine that will run Agent Bridge. Install Node.js and the `heyhey` CLI, run `heyhey pair`, and follow the CLI-issued enrollment handoff in the browser. The browser reviews the machine and creates a native WebAuthn passkey controller with user verification. Return to the CLI and review the claimant and machine details; explicit local confirmation signs the exact enrollment before the machine is activated. A browser session or account login by itself cannot restore local execution authority, and there is no website-only pairing path.
