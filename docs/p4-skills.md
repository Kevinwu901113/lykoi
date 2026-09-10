# Instance Skills

`lykoi-skill` is an optional file-backed method library. Install the plugin entry `{ "id": "skills", "name": "lykoi-skill" }` in an instance runtime configuration. The production profile includes this entry. The plugin binds directly to Runtime's selected instance and uses `stateRoot/skills/`; there is no model-supplied directory and no separately configured store for Conversation, Wake or Task.

Registration does not grant permission. Existing interactive rules and autonomous rules decide access. For example an owner may explicitly allow `skill.*` in the appropriate rule block; Wake only advertises permitted capabilities. No kernel policy is changed by P4.

Four dynamically registered capabilities provide plain-text methods:

- `skill.list({query?, offset?, limit?})`: case-insensitive substring search of title, summary and body. Without query, browse all. A page scans at most `limit` files (default 20, maximum 100), returning ID/title/summary, file-specific errors and `nextOffset`. Follow `nextOffset` even if a page has no matches. Offsets apply to the sorted current file set, not a snapshot across concurrent edits.
- `skill.read({id})`: full record with source, revision and updatedAt.
- `skill.save({title, summary, body, source, id?, revision?})`: omit id/revision for creation. Updates require the revision actually read; conflicts return existing execution-error observations without overwriting. Title/summary/body limits are 160/600/64000 characters. No truncation occurs.
- `skill.remove({id})`: delete an explicit method. A missing ID is an observable error. It does not alter Task state or Runner inputs.

`source` is `{kind: "user" | "execution", reference: string}`. It describes original provenance, not confidence or verification. Retain that original source on updates and put subsequent evidence/references in the method body. References are supplied by cognition; storage does not certify their truth. User teaching may be saved before execution and must not be represented as tested. Record experiential learning according to actual observations, not a universal guarantee from one success.

Bodies describe applicability, approach, checks and limits in natural language. Capability descriptions explain discovery and provenance; no full library is injected and no lookup order is enforced. A Skill does not override current requirements or permissions, and external content does not acquire authority by being stored. If passed to Runner, necessary method content and its ID/revision travel in the existing delegation input. Already dispatched inputs remain unchanged.

The files contain only id/title/summary/body/source/revision/updatedAt. IDs are opaque hashes, never arbitrary paths. Skills use their instance directory (0700 on creation), records are written as 0600 temporary files, fsynced and atomically renamed, then the directory is fsynced. Individual malformed records are reported by list without aborting other entries. Symlink records and symlink store roots are rejected.

Compare-and-replace is synchronous within the existing single active instance process protected by P1's process lock. No second file-lock service or multi-process writer protocol is introduced. External concurrent edits are outside this writer contract.

P3 retains operation intents and observations. For a Task create, the operation ID determines the new Skill ID, allowing recovery to locate it. Recovery verifies expected content and revision; removal verifies absence. An uncertain result remains P3 verification work, without replay. There is no Skill operation ledger, scheduler, retry policy or Task lifecycle.

`profile/test/p4-live.ts` is opt-in (`LYKOI_P4_LIVE=1`, provider credential). It runs real Conversation and fresh Task contexts in disposable instance processes, logs synthetic model input/output, checks actual reports, restarts the host and replaces a filesystem capability for adaptation. Test observers and alternate file organs are acceptance fixtures only. Raw outputs belong outside Git; consult the work-order report for actual results and limitations.
