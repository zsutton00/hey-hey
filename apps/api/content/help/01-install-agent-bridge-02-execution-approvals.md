---
id: 10000000-0000-4000-8000-000000000003
slug: execution-approvals
title: Approve execution on a machine
parentId: 10000000-0000-4000-8000-000000000001
ordering: 2
demos: []
---
A browser approval authorizes one exact host-affecting action for the selected machine, project, and agent session. The browser uses the enrolled controller passkey with user verification; the API checks the action, payload, target, expiry, and controller before admission. Follow-on work may use a narrowly scoped grant, but it cannot widen the approved action or target. If an approval expires, is consumed, or does not match the requested action, start a new approval instead of retrying the old one.
