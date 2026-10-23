---
id: 10000000-0000-4000-8000-000000000006
slug: recover-after-losing-all-controllers
title: Recover after losing all controllers
parentId: 10000000-0000-4000-8000-000000000001
ordering: 5
demos: []
---
If every active controller is lost or revoked, recovery must happen on the exact local machine that is being recovered. Start a new local enrollment there, create a replacement browser passkey, review the claimant and machine details in the CLI, and complete explicit local confirmation. Account access, a website session, or a passkey added only on another computer cannot restore authority to the machine. If that exact machine is unavailable, treat the machine as unavailable and report the problem rather than promising remote recovery.
