# WO-P4-SKILL-01 — Instance-private reusable methods

Authorized by Kevin on 2026-09-10. Baseline P3 `86db58c`, P2 merged `48ec5f6`.

Implement a thin `lykoi-skill` plugin with list/read/save/remove registered through P2. Runtime instance binding supplies `stateRoot/skills`; no model path or independent resolver. Natural-language records retain original provenance, optimistic revision and atomic file replacement. P1's active-instance process lock remains the writer boundary. P3 owns operation history/recovery; Skill recovery verifies files without another ledger or replay.

Acceptance: persistence, isolation, corruption isolation, stale-update conflict, deletion and recovery; shared Conversation/Wake/Task registration; real-model ability composition, method teaching and reuse after restart in fresh context, adaptation to missing capability. No new scheduler, routing strategy, skill mining, database, permission grant or Runner store. Existing kernel decisions stay in force. Code, tests, evidence and limits must be reported separately from merge/deployment.
