---
id: 10000000-0000-4000-8000-000000000012
slug: protected-credential-store-failures
title: Protected credential-store failures
parentId: 10000000-0000-4000-8000-000000000001
ordering: 11
demos: []
---
Agent Bridge stores machine secrets and the local integrity key in the operating-system protected credential store. If that store is unavailable, unreadable, or cannot protect the required state, the CLI does not invent a fallback, accept an account token as authority, or continue with unverified local data. Stop on the exact local machine, restore its protected credential store, and rerun the local enrollment or reconciliation flow. A website session cannot repair a missing local secret.
