/** Shared bounded execution. Prompts, state writes and delivery belong to the caller. */
export type CognitionDecision<Action, Result> =
  | { kind: 'act'; action: Action }
  | { kind: 'finish'; result: Result }
export type CognitionOutcome<Result> =
  | { status: 'finished'; result: Result; actions: number }
  | { status: 'budget_exhausted'; actions: number }

export async function runCognition<Action, Observation, Result>(options: {
  maxActions: number
  signal?: AbortSignal
  reason(step: { index: number; closing: boolean }): Promise<CognitionDecision<Action, Result>>
  act(action: Action, index: number): Promise<Observation>
  observe(observation: Observation, action: Action, index: number): Promise<{ kind: 'finish'; result: Result } | void> | { kind: 'finish'; result: Result } | void
}): Promise<CognitionOutcome<Result>> {
  if (!Number.isSafeInteger(options.maxActions) || options.maxActions < 0) throw new TypeError('maxActions must be a non-negative integer')
  for (let index = 0; ; index++) {
    options.signal?.throwIfAborted()
    const decision = await options.reason({ index, closing: index === options.maxActions })
    options.signal?.throwIfAborted()
    if (decision.kind === 'finish') return { status: 'finished', result: decision.result, actions: index }
    if (index === options.maxActions) return { status: 'budget_exhausted', actions: index }
    const observation = await options.act(decision.action, index)
    const observed = await options.observe(observation, decision.action, index)
    if (observed?.kind === 'finish') return { status: 'finished', result: observed.result, actions: index + 1 }
  }
}
