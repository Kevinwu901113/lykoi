---
name: lykoi-governance-landing-review
description: Review a Lykoi Cordis implementation handoff or merge, or prepare Kevin-root production landing with task-specific evidence. Use for go, 合, LANDING, manifest, and production-evidence requests.
allowed-tools: Read, Grep, Glob, Bash
---

# Lykoi governance landing review

## Scope and authority

Use the current checkout's [CLAUDE.md](../../../CLAUDE.md) for execution, clarification, checks, reporting and permission boundaries. This project copy supersedes the historical copy in local memory. A classification-only request authorizes the classification, not implementation or dispatch.

Read authorization in context: `go` advances the prepared governance step and `合` authorizes its no-fast-forward merge; equivalent explicit instructions and existing scoped preauthorization also count. Do not ask again for authorization already given. Root production actions remain Kevin's. Direct implementation in an authorized isolated branch is allowed; independent acceptance must be performed by someone who did not implement the change.

## Establish the evidence

- Identify the current Git root, branch, commit, remote and task association before choosing a checkout. Historical absolute paths are candidates, not authority; do not switch away from the task checkout merely to match an old path.
- Read the relevant `governance/wo/<id>/{order,report,review}.md`, current HANDOFF sections and affected normative clauses. Historical progress snapshots are evidence of their date, not new tasks.
- Inspect the complete diff and affected dependency/import boundaries. Apply the checks in CLAUDE.md to the change type; reuse valid results for the same commit and relevant environment. Document-only work does not require runtime test suites or production probes.
- For changed behavior, verify the relevant user path. Distinguish model intent, gate pass, actual dispatch, delivery and acknowledgement; green tests or an active service alone do not prove delivery.

## Complete the requested stage

- **Implementation handoff / review:** record scope, artifacts, applicable checks, findings and remaining evidence in the work order. Missing independent review blocks acceptance, not authorized implementation or delivery preparation.
- **Merge:** check independent review and scoped merge authorization immediately before merging. After an authorized merge, verify the resulting commit and local/remote branch state. A review-only request does not require a deployment bundle.
- **Production landing preparation:** only when deployment is in scope, prepare the pinned commit/tree, checksum, backup, applicable manifest re-sign and gate checks, restart steps, rollback and post-start evidence. Give Kevin copyable commands with expected results and stop conditions. Do not execute root actions.
- **Deployment acceptance:** report only returned or directly observed evidence: deployed revision, applicable manifest/gate, units, restart counts and the task's real audit/user-path sample. Mark missing production evidence pending rather than inferring success.

A failed gate, absent review or missing merge authorization blocks only the dependent acceptance, merge or deployment. Continue authorized diagnosis, isolated repair, verification and artifact preparation. Stop a permission-denied operation and its dependent steps without bypassing the restriction; continue unrelated authorized work. Return a blocked report when all remaining work requires external input.

## Fragile landing details

Apply these only to the affected deployment or script:

- Under `set -euo pipefail`, explicitly handle expected zero-match filters; do not suppress real command errors. Compare counts numerically and make critical assertions explicit. Validate release assertions under Linux semantics.
- A change to manifest-covered source still requires the deployment's backup, manifest update, gate and restart procedure. This does not require production actions during source review.
- Browser egress containment needs redirect-safe enforcement. When changing that boundary, verify the systemd cgroup deny rules with a real redirect-to-private probe; request routing alone is insufficient.

Keep the report proportional to the task: lead with the verified stage and findings, link the complete evidence, and distinguish implementation, independent acceptance, merge and deployment. Do not repeat unrelated production checks for every review.
