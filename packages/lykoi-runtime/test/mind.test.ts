import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MindStore } from '../src/mind.ts'

const record = { id: 'question', revision: 0, kind: 'thought' as const, topic: '共享结构？', understanding: '还缺第二个案例', open: '比较不同领域', evidence: ['case:A'], links: [], status: 'open' as const, reconsiderAt: null, basis: 'inferred' as const, scope: '方法研究' }
test('restart resumes progress; event replay deduplicates; stale commits roll back updates and acknowledgements together', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-')), path = join(root, 'mind.sqlite')
  let mind = new MindStore(path)
  t.after(() => { mind.close(); rmSync(root, { recursive: true, force: true }) })
  mind.commit({ records: [record] }, 'conversation', mind.view())
  mind.close(); mind = new MindStore(path)
  const event = { id: 'result:B', source: 'task', reference: 'B', content: '第二案例与原假设不同', createdAt: '2026-09-10T00:00:00Z' }
  mind.receive(event); mind.receive(event)
  assert.equal(mind.view().events.length, 1)
  const old = mind.view(), previous = old.records[0]!
  mind.commit({ records: [{ ...previous, understanding: '共同结构成立，但实现细节不能泛化', evidence: ['case:A','result:B'] }], acknowledge: [event.id] }, 'wake', old)
  assert.equal(mind.view().events.length, 0)
  mind.receive(event); assert.equal(mind.view().events.length, 0)
  mind.receive({ ...event, id: 'result:C' })
  const conflictView = mind.view()
  assert.throws(() => mind.commit({ records: [{ ...previous, understanding: '旧快照覆盖' }], acknowledge: ['result:C'] }, 'old-worker', conflictView), /revision conflict/)
  assert.equal(mind.view().events.length, 1)
  assert.equal(mind.view().records[0]!.understanding, '共同结构成立，但实现细节不能泛化')
  assert.throws(() => mind.commit({ acknowledge: ['unseen'] }, 'wake', conflictView), /unseen/)
})
test('feedback dimensions stay separate and inferred understanding cannot mutate another record accidentally', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-feedback-')), mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => { mind.close(); rmSync(root, { recursive: true, force: true }) })
  mind.commit({ records: [
    { ...record, id: 'topic', kind: 'preference', understanding: '关注持续认知' },
    { ...record, id: 'format', kind: 'preference', basis: 'explicit', understanding: '结论优先', evidence: ['user:correction'] },
  ] }, 'conversation', mind.view())
  const seen = mind.view(), format = seen.records.find(r => r.id === 'format')!
  mind.commit({ records: [{ ...format, understanding: '结论优先，细节按需', evidence: [...format.evidence, 'user:correction2'] }] }, 'conversation', seen)
  assert.equal(mind.view().records.find(r => r.id === 'topic')!.revision, 1)
  assert.equal(mind.view().records.find(r => r.id === 'format')!.basis, 'explicit')
})

test('legacy open thoughts migrate once without changing original memory or resetting later understanding', async t => {
  const { DatabaseSync } = await import('node:sqlite')
  const root = mkdtempSync(join(tmpdir(), 'mind-migration-')), source = join(root, 'memory.db')
  const db = new DatabaseSync(source)
  db.exec("CREATE TABLE thoughts(id INTEGER, content TEXT, related_concern_id INTEGER, status TEXT); INSERT INTO thoughts VALUES(1,'历史问题',2,'open'),(2,'已完成',NULL,'resolved')")
  const mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => { mind.close(); db.close(); rmSync(root, { recursive: true, force: true }) })
  mind.migrate(source)
  assert.equal(mind.view().records.length, 1)
  const view = mind.view(), old = view.records[0]!
  mind.commit({ records: [{ ...old, understanding: '后来的理解' }] }, 'wake', view)
  mind.migrate(source)
  assert.equal(mind.view().records[0]!.understanding, '后来的理解')
  assert.equal(db.prepare('SELECT content FROM thoughts WHERE id=1').get()!.content, '历史问题')
})
