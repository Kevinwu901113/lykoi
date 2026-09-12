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
