# Persistent Task / Pi Runner

P3 builds on the P1 instance and P2 cognition loop. Task is a durable goal, not a second agent. The implementation has passed local regression checks and the disposable-instance acceptance below; it has not been deployed to the existing character.

`lykoi-task` owns three tables in the existing instance memory DB: tasks, cognition runs and operations. Workspaces live under `stateRoot/tasks/<id>/workspace`. Profile assembly supplies paths; CharacterInstance does not know plugin filenames. Run one active instance through `profile/instance.ts`, which retains P1's process lock and drain boundary.

An operation intent is committed before dispatch. Its observation and any external-operation wait are committed together. Recovery queries an installed capability's optional `recover` hook; absent or unsuccessful verification means waiting, not replay. Workspace reads can be repeated; writes are verified against actual file contents. Unknown shell-command effects require verification. Paused tasks stay paused. Pending Runner work owns its task materials until a terminal receipt is confirmed.

Each run uses `runCognition`, has an action budget and reads current requirements. An earlier revision cannot finish the task. Two identical failed executions under the same requirements prevent a third identical dispatch; changing the approach remains the model's responsibility. JSON/protocol retries remain in `lykoi-llm`. Recent observations stay in context; `task.history` pages older records. Large observations are files in the task workspace.

Acceptance of a follow-up happens only after the task exists in SQLite. Existing unfinished Continuations migrate once by a unique source-row marker. Interrupted work and historical delivery failures wait for verification. The old Continuation executor and ledger-only Delegation action facade are retired; historical tables remain readable evidence.

Task completion records checked file paths, sizes and SHA-256 hashes. Delivery has its own pending/sending/sent/failed/unknown status. A confirmed send failure retries delivery only. A crash during sending requires verification. Completed tasks contribute one Experience through an idempotent Memory reference, including after a restart between the memory write and Task checkpoint.

## Controls

Console and owner Telegram messages accept:

```
/task list
/task get TASK_ID
/task create GOAL
/task update TASK_ID FULL_LATEST_REQUIREMENTS
/task pause TASK_ID
/task resume TASK_ID
/task cancel TASK_ID
/task approve OPERATION_ID
/task retry-delivery TASK_ID
/task verify TASK_ID OWNER_VERIFIED_FACTS
/task delivery TASK_ID sent
/task delivery TASK_ID failed
```

`verify` and delivery confirmation are explicit owner commands, not model capabilities. Normal conversation can create follow-ups, inspect tasks and update requirements through registered capabilities. Task cognition cannot rewrite its own user requirements.

Tasks continue to use existing interactive permission rules for an accepted user goal. Hard-gated actions still require approval. A task approval queues the exact persisted action; it does not report that the external action already ran. Changing requirements invalidates old approvals. Cancellation does not undo completed external effects.

## Pi deployment

The Runner is optional and must be explicitly configured. Its implementation was probed against `@earendil-works/pi-coding-agent@0.85.1` using the official [RPC interface](https://pi.dev/docs/latest/rpc). Pi is an external executable, not installed by cognition.

Example additional profile entry (instance assembly supplies `dbPath` and `root`):

```yaml
- id: pi
  name: lykoi-runner-pi
  config:
    command: ["/path/to/node", "/path/to/pi/dist/cli.js", "--thinking", "low"]
    provider: deepseek
    budgetRoute: deepseek-official
    model: deepseek-v4-flash
    agentDir: /path/to/deployment/pi-config
    credentialEnv: [DEEPSEEK_API_KEY]
    timeoutMs: 300000
    maxTurns: 8
```

`agentDir` holds deployment model configuration and credential references; sessions and execution receipts stay under the instance. Credentials are passed only through the explicitly named environment variables. Pi executes with the deployed OS user's permissions; cwd is not an OS sandbox. Configure the OS boundary before enabling it, as for the existing command capability.

A detached worker owns the Pi RPC session. Reconstructing Lykoi reconnects to that worker or reads its final receipt. Missing connectivity is unknown, never evidence that Pi stopped. Cancellation clears queued prompts, aborts, and checks idle state. RPC automatic retry is disabled. Each execution has a deadline and turn limit. Launch uses the existing budget gate; actual session usage is charged once by receipt ID to the configured budget route. Accounting is per bounded Runner execution, not per internal Pi model request.

`delegation.dispatch/status/collect` now refer to real Pi execution and the existing Delegation contract/receipt. A successful Pi exit produces a collected receipt, not a verdict that the user's goal is satisfied. Task cognition must inspect the artifacts.

## Acceptance

Local tests cover durable claims, revision changes, pause/cancel races, crash-before-checkpoint recovery, real filesystem observations, Telegram transport rejection with delivery-only retry, idempotent Experience and budget receipts, and a separate RPC process surviving its host process. The RPC process fixture is explicitly not a real-model acceptance.

`profile/test/p3-live.ts` runs real Conversation and Task models in disposable Character Instance processes, adds a requirement, kills and restores the host, checks real files and received console messages, then repeats the host restart while real Pi is working. It requires explicit `LYKOI_P3_LIVE=1`, a provider credential and `LYKOI_PI_CLI`. Runtime state from the existing character is not used as a writable test fixture. Raw test evidence belongs outside Git.

Acceptance on 2026-09-10 used DeepSeek V4 Flash and Pi 0.85.1:

- Conversation persisted a task, changed its requirements through `task.update`, remained interactive, and retained pause across a killed host. Recovery produced and delivered a 6,434-byte report containing the new requirement; its persisted artifact hash was checked. The first harness assertion assumed the wrong subdirectory; checking the actual artifact confirmed the result and the harness now uses that reference.
- A real Pi execution survived a killed host with one dispatch and one prompt intent. It finished in eight turns, produced `validate.mjs` and a 4,073-byte report, and tested the supplied input (two valid items, total 18) plus negative cases. Task read the result and delivered it through Console.
- An owner cancellation during Pi's real `sleep 30` confirmed a cancelled receipt, no subsequent artifact and no new task actions. A separate subprocess test kills the process after a durable filesystem effect but before its checkpoint, then confirms recovery waits without replay.
- Delivery failure/retry uses the actual Telegram transport against controlled HTTP responses; no real Telegram messages were sent. Console delivery was received by the real worker client. Existing-character production state was not a fixture and no deployment occurred.

Earlier trials exposed a missing read-lock wait in the acceptance observer, incorrect Pi environment-reference syntax, a too-small six-turn Runner limit, and provider JSON failures. The harness/configuration issues were corrected; invalid provider output remains a bounded adapter failure, without an extra Task retry layer. All trials consumed 186,386 accounted tokens. Raw logs, receipts and artifacts stay outside Git; machine-generated evidence is not another governance source.
