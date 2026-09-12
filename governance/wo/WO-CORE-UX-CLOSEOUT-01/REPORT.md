# Core UX closeout candidate

## Problem and change

Production 5321b3f accepted a conditional file approval but executed the old file contents first. The Kernel now returns revision_requested for conditional approval (or approve with conditions), never executes old parameters and creates neither grant nor denial. The approval conversation retires old authority and returns the full raw amendment to existing Cognition. Task-backed requests validate instance, operation identity/arguments/revision/status, then use the existing Task update transaction to invalidate old operations; paused tasks stay paused and scheduled-message tasks fail closed on this path. Revised actions require fresh approval.

Production resume approval omitted the action verb and was interpreted as unclear. Task control/read descriptions now name the action. Task terminal state retires its obsolete control approvals; read/history requests remain independently pending. File success receipts are concise, and Converse is instructed not to repeat internal tool/status explanations.

## Validation

Typecheck passed. Full suite: 1,282 tests, 1,271 passed, 0 failed, 11 skipped. Targeted regressions cover conditional no-execution/no-grant/no-denial, raw amendment forwarding, callback failure preserving authority, Task revision and action binding, pause preservation, stale operation rejection, obsolete control retirement, and readable descriptions. Real loopback tests used the approved local environment; no tests were changed to mask environment errors.

Latest real Telegram evidence on production 5321b3f: body-only reminder update retains exact dueAt; pause and cancel work, and cancelled reminder stays undelivered past due. Resume and mixed file approval failed as described above. File attachment receipt plus owner-downloaded bytes already passed on #17. A new program request proposed a bounded synthetic deduplication command, but multiple pending requests prevented natural target selection; no execution or file result is claimed. Existing replyTo is the precise selection path; this work does not weaken ambiguous matching or authorize a guessed target. Native computer-use mouse actions were unavailable, preventing an explicit quoted-reply test.

## Independent review

Governance review accepted the conditional-revision and identity checks. Follow-up review found that natural background completion also needed control-approval retirement; service and timer now share a scan wrapper with finally retirement. An actual plugin completion regression verifies control retirement while preserving get/history. Final independent verdict: ACCEPT, no remaining code or deployment-packet blocker, conditional on the final full checks passing.

## Delivery boundary

Owner authorized fixing, reviewing, merging, and preparing deployment. Root deployment remains owner-operated. After deployment, use fresh requests to verify corrected conditional approval and reminder resume, finish the program/Task/Pi acceptance, and retain failures if they recur. Do not restore or replay old cancelled requests. Panel-wide UX, actual vision supply and long-term personality quality are not declared complete. Current state is recorded in governance/CURRENT_VERSION.md; historical reports retain their historical meaning.
