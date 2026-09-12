import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { taskFacts } from 'lykoi-runtime/task-facts'
import { TaskStore } from '../../lykoi-task/src/store.ts'
import { makeConversation, envelope, T0 } from './fixture.ts'

test('each real Conversation model request sees revised requirements and current delivery separately from original goal', async t => {
  const root = mkdtempSync(join(tmpdir(), 'converse-facts-'))
  const tasks = new TaskStore(join(root, 'tasks.sqlite'), 'fixture', root)
  t.after(() => { tasks.close(); rmSync(root, { recursive: true, force: true }) })
  const old = tasks.create({ goal: 'OLD', message: { text: 'OLD', delaySeconds: 120 } }, T0)
  tasks.create({ taskId: old.id, goal: 'NEW', message: { text: 'NEW' } }, new Date(T0.getTime() + 1000))
  const h = makeConversation({ taskContext: () => JSON.stringify({ tasks: tasks.list().map(task => taskFacts(task)) }) })
  const inspect = (state: string | null) => {
    h.llm.push(call => {
      const view = JSON.parse(call.messages.find(message => message.content?.startsWith('{"tasks":'))!.content!).tasks[0]
      assert.equal(view.requirements, 'NEW')
      assert.equal(view.scheduledMessage.text, 'NEW')
      assert.equal(view.history.originalGoal, 'OLD')
      assert.equal(view.delivery?.state ?? null, state)
      assert.equal(view.snapshot.kind, 'current')
      return { content: envelope() }
    })
  }
  inspect(null); await h.conversation.send('当前提醒是什么？', { runId: 'facts-1' })
  tasks.edit(old.id, task => { task.status = 'completed'; task.delivery = { state: 'sent', content: 'NEW', attempts: 1, error: null, receipt: { messageId: 47 } } }, new Date(T0.getTime() + 120000))
  inspect('sent'); await h.conversation.send('是否真的送达？', { runId: 'facts-2' })
  assert.equal(h.llm.calls.length, 2)
})
