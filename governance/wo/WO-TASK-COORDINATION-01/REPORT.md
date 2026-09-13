# Task approval coordination

Production Pi execution succeeded and actual synthetic artifacts were verified, but Task requested repeat inspection while foreground also requested a terminal inspection. Multiple pending requests then could not be resolved even when the owner explicitly quoted the desired filename. The Task remained waiting after foreground reported Pi success.

Queued approval observations now carry task_id, operation_id and execution_owner. Foreground receives the execution ownership contract: Task owns verification, further approvals and final delivery; progress uses Task facts/history and distinguishes operation success from completed Task. Task cognition recognizes already verified content in operation receipts as evidence, while still requiring comparison against current requirements. These are context/protocol improvements, not a deterministic prohibition on all redundant model actions.

Kernel target resolution now recognizes a uniquely quoted complete structured file path before token scoring. Native reply references retain priority. File references identify only the subject; original approve/deny/conditions interpretation and gates remain unchanged. Duplicate paths and incomplete file references across multiple requests fail closed, including identical basenames in different directories. No permission policy change.

Regression coverage: mixed Task approval plus independent question; exact quoted file subject, native quote precedence, suffix/partial mismatch, same-file read/write ambiguity, multiple directories, denial and conditional revision. Independent review identified a basename/fuzzy-fallback issue; fixed and covered before delivery. Production test records stay in local landing evidence, not Git.

No profile, credential, quota, schema or dependency changes. Old pending/unknown/failed operations are not replayed. Fresh production acceptance after owner rollout must verify Task completed, actual artifacts and final delivery; local fixture tests alone cannot establish natural model behavior.

Final validation: full 1288 tests, 1277 passed, 0 failed, 11 skipped; typecheck clean. Independent code/kernel and landing-script review ACCEPT.
