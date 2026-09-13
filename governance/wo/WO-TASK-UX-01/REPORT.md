# Task UX repair

The previous live Task reached completed and delivered real verified artifacts, but required two extra read approvals and repeatedly narrated old task failures. Prior prompt-only evidence guidance did not remove that friction.

User Task execution now treats its own isolated workspace read/list as part of the delegation. It checks durable operation/task identity, revision, action/arguments, instance and workspace, records the decision and still enters Kernel dispatch. Explicit deny remains stronger than preApproved; workspace realpath isolation still rejects escape. No standing grant is created. Autonomous tasks, foreground reads, writes, terminal commands and exports retain their existing gates.

Default foreground Task context is now a compact current index: id, current requirements summary, status/revision/time, wait kind and delivery state. It no longer automatically injects full old goals, requests, failure details, result bodies and receipts on every turn. Complete facts/history remain queryable. The 160-character summary is for locating relevant work, not proving detailed requirements or completion. Foreground and result protocols request concise user-facing replies and leave full evidence in operation/artifact records. Natural model wording still requires production acceptance.

Validation: typecheck clean; full 1298 tests, 1287 passed, 0 failed, 11 skipped. Real Cordis fixtures cover user read/list completion without extra approval, explicit deny, path escape and symlink escape, audit failure with zero dispatch, autonomous and unrelated capability gates. Conversation regression verifies revised current summary and delivery while original history stays available on demand. Independent governance review ACCEPT.

No profile, quota, credential, schema or dependency changes, no old task state edits or replay. Owner-operated rollout then fresh natural Task/Pi acceptance remains required.
