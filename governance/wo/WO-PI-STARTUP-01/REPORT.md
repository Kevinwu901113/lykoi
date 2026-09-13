# Pi startup repair

Production accepted a user-owned Task and approved its Pi operation, but prompt RPC failed while opening auth.json in the root-owned read-only deployment directory. auth.json did not exist: the credential store needed a writable location. Pi created a session, then worker cleanup terminated it; exit143 and subsequent socket ENOENT overwrote the original failure.

Each operation now creates its own0700 agent directory. Only deployment models.json is snapshotted into it as0600; deployment auth/settings are neither copied nor modified. Existing credential environment references remain unchanged. Preparation errors are reported before child launch. Worker exit and unreachable-socket observations retain the original error. Unknown outcomes still require verification and are never automatically replayed.

Validation: typecheck passed; full1286 tests,1275 passed,0 failed,11 skipped. Real detached-worker fixtures cover rejected RPC evidence across exit/reconnection with no replay, and successful work with a read-only deployment directory while auth is created privately and deployment files remain unchanged. Independent review ACCEPT. Fixtures are not production model acceptance: fresh Task/Pi artifacts remain pending owner rollout.

No dependencies, profile, quota, schema or Gate code changes. Owner supplied original failed RPC evidence; no production credentials were read. Failed test IDs and raw diagnostic evidence remain in the local landing record.
