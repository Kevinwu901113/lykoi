import type { TaskSummary } from 'lykoi-contracts'

/** A read projection, never another source of task state. Historical goals are not executable requirements. */
export function taskFacts(task: TaskSummary, kind: 'current' | 'event' = 'current') {
  return {
    id: task.id, createdAt: task.createdAt,
    snapshot: { kind, revision: task.revision, updatedAt: task.updatedAt },
    history: { originalGoal: task.goal, originalRequest: task.request },
    requirements: task.requirements, criteria: task.criteria,
    status: task.status, checkpoint: task.checkpoint, wait: task.wait,
    scheduledMessage: task.scheduledMessage ?? null,
    result: task.result, finding: task.finding, failure: task.failure,
    artifacts: task.artifacts, delivery: task.delivery,
    origin: task.origin, thoughtId: task.thoughtId, reason: task.reason,
  }
}

/** Default conversation index. Full evidence remains available through task.get/history. */
export function taskIndex(task: TaskSummary) {
  return {
    id: task.id, status: task.status, revision: task.revision, updatedAt: task.updatedAt,
    summary: task.requirements.slice(0, 160),
    wait: task.wait ? { kind: task.wait.kind, until: task.wait.until } : null,
    delivery: task.delivery ? { state: task.delivery.state } : null,
  }
}
