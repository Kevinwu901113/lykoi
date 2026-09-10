# P4 — implementation and acceptance

Implemented on P3 `86db58c`. P2's shared cognition/dynamic registration and P3's task operations remain the execution path. No Resolver, routing order, Skill executor, new task state or permission bypass was added. Runtime source addition is 164 lines in `lykoi-skill`; existing cognition/Task/Runner/kernel implementations are unchanged.

The plugin registers list/read/save/remove against the selected Runtime instance's `stateRoot/skills`. Records hold natural-language methods, original source, revision and timestamp. Updates compare the read revision; writes fsync a private temporary file and atomically replace the record. List returns bounded discovery pages and per-file corruption errors. P1's one-active-instance process boundary supplies writer ownership. P3 recovery inspects saved content/revision or confirmed absence, without another ledger or write replay.

Source is the original `{kind, reference}` and is retained across updates; later evidence belongs in the body. It is a traceable model-supplied reference, not a runtime certification. Descriptions explain discovery, experiential adaptation, current requirements, denied-resource boundaries and passing method ID/revision with existing Runner inputs. No complete library is injected. The profile installs the plugin; existing permission configuration still determines access, especially autonomous use.

## Validation

Local Node 26.4.0, matching the repository's Node >=24 requirement:

- Complete regression: **1211 tests, 1200 passed, 0 failed, 11 skipped**. Existing skipped tests remain skipped. `npm run typecheck` and `git diff --check` pass.
- New targeted tests cover competing stale revisions (one succeeds), persistence/deletion after reopening, unchanged origin, corrupt-file pagination, opaque IDs, symlink and cross-instance exclusion, actual Cordis registration/disposal, obsolete handler rejection and P3 save/remove recovery without replay.
- Actual `deepseek-v4-flash` calls through the existing adapter, kernel, dynamic Runtime and isolated instance processes; no production character data or Telegram messages. All trials accounted **112973 tokens**, including failures and supplemental checks.

### A: capability composition

Conversation read `first.log`, extracted its actual randomized `alpha-e40d8b1c` payment timeout, wrote `report-first.md`, then saved a method with source `user:p4-teaching-1`. No log analyzer or scenario routing code exists. The saved method explicitly preserves the user's three fields, final uncertainty section and usual `workspace.read` approach.

### B: restart and real reuse

After host restart, a fresh persistent Task was given only a new `current.log` and a request to follow the user's existing report habit. Its first model input contained neither “证据钉” nor old operations. It chose workspace inspection, searched Skills, broadened an empty substring query to browsing, read the full Skill, wrote and reread `report.md`, and delivered through the actual console path. The report includes the new beta marker and “证据钉 / 影响窗 / 复核步 / 未证实项”, without the old alpha conclusion. Operation records and verified file artifacts are retained.

### C: changed capability

After another restart, an acceptance-only organ replaced `workspace.read` with `file.read` using the same actual filesystem implementation. The model read the existing Skill but used the currently registered `file.read`, produced a new gamma-based report, reread it and completed delivery. It did not need a framework fallback or Skill revision. Together, A/B/C consumed 22 successful model calls. The alternate organ only changes the available test environment; it performs no cognition or routing.

### Shared Wake and explicit denial

Actual Wake used the same plugin/store to list, read, then `record_note`; the real `autonomy_notes` row contains the taught fields and source. This uses a synthetic heart/clock fixture and real cognition/model/dispatch/storage, not a live heart timer.

A separate stored external method suggested changing tools after denial. Two actual kernel dispatches remained denied even with `preApproved: true`. A real Conversation then read the stored method and explicitly rejected its bypass advice; neither resource handler ran. This is evidence for the tested action/resource boundary, not a claim that natural-language descriptions sandbox arbitrary OS commands or Runner permissions.

## Failures retained

The first trial saved and used the method in Conversation but its next Task returned `invalid task decision`; it was recorded as failed. That trial lacked raw Task response capture, so its exact malformed output is unknown. We added an acceptance-only model observer and ran a new isolated trial; no Task parser relaxation, retry loop or hidden replay was introduced.

The first Wake assertion incorrectly expected a `record_note` payload in the thoughts table. The actual response had selected record_note. The harness now inspects `autonomy_notes`, and the complete supplemental run passed. The first denial sample refused access before reading the Skill, so it did not prove handling of stored advice; a targeted second sample explicitly permitted reading the method, then confirmed both reading and refusal. All trials remain in evidence.

## Evidence and limits

Raw synthetic evidence, reports, operation records and test logs live outside Git at `/Users/wukevin/lykoi/p4-acceptance/`:

| File | SHA-256 |
| --- | --- |
| scenario-evidence.json | 7f9acb80966cac43186e2311b4d2800744e8678c1393c231288c8e8fe0fbd210 |
| saved-skills.json | bc5ce2c66e2da9d5bcae74840ba4262b8673749e5014c7b24a1192955c1bf096 |
| wake-evidence.json | e221c0b56de02d88db3407bfbe253812231211943405cbc71886fd19b21cb9da |
| denial-evidence.json | 4a0a8ee09f1b7f1f87c8c5c163344dc21f17584bc90109171c34c3b362b10b2e |
| initial-failed-task.json | 024e2ab16d782d7e1ba014a127dc8f06e790005283203f52059c3d2ca25ac424 |

These are bounded synthetic acceptance samples, not a claim of general learning quality or fewer model calls. No P4-specific live Pi task was needed: the verified path used filesystem capabilities, and Runner implementation/inputs were untouched. References remain model-supplied; search is plain substring matching and currently requires browsing when wording differs. Concurrent external file editors are outside the single active process contract.

Code and evidence are ready for review. Main merge and deployment have not been performed. See `docs/p4-skills.md` for configuration and API semantics.
