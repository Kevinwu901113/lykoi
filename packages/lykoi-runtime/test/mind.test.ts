import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitMind, MindStore, mindWorkingView } from '../src/mind.ts'

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
  const conflictView = { records: old.records, events: mind.view().events }
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


test('model writes semantic content; snapshot owns revisions and open owns lifecycle', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-content-')), mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => { mind.close(); rmSync(root, { recursive: true, force: true }) })
  // Metadata carried by an old model output cannot increment versions or hide an unfinished question.
  mind.commit({ records: [{ ...record, revision: 999, status: 'resolved' }] }, 'model', mind.view())
  const first = mind.view()
  assert.equal(first.records[0]!.revision, 1)
  assert.equal(first.records[0]!.status, 'open')
  const event = { id: 'completed-task', source: 'task', reference: 'question', content: '真实结论', createdAt: new Date().toISOString() }
  mind.receive(event)
  mind.commit({ records: [{ ...record, open: null, revision: 888 }], acknowledge: [event.id] }, 'model', mind.view())
  assert.equal(mind.view().records[0]!.revision, 2)
  assert.equal(mind.view().records[0]!.status, 'resolved')
  assert.equal(mind.view().events.length, 0)
  // Closing stays readable; another call can reconsider it rather than losing it immediately.
  assert.equal(mind.view().records[0]!.open, null)
})

test('working set keeps preferences and event-related records; searched history gets a fresh read version', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-focus-')), mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => { mind.close(); rmSync(root, { recursive: true, force: true }) })
  mind.commit({ records: [{ ...record, id: 'history', open: null }, ...Array.from({length: 25}, (_, i) => ({ ...record, id: `active-${i}` }))] }, 'seed', mind.view())
  assert.ok(!mind.view().records.some(r => r.id === 'history'))
  assert.throws(() => mind.commit({ records: [{ ...record, id: 'history' }] }, 'unseen', mind.view()), /revision conflict/)
  const reads = new Map([['history', 20]])
  mind.commit({ records: [{ ...record, id: 'history', understanding: '重新考虑' }] }, 'reader', mindWorkingView(mind, reads))
  assert.equal(mind.view('history').records[0]!.revision, 2)
  mind.commit({ records: [{ ...record, id: 'preference', kind: 'preference', open: null }] }, 'seed', mind.view())
  assert.equal(mind.view('preference').records[0]!.open, null)
  mind.receive({id:'event',source:'task',reference:'history',content:'新证据',createdAt:new Date().toISOString()})
  assert.equal(mind.view('', 1).records[0]!.id, 'history')
})

test('old contradictory lifecycle migrates once without discarding unresolved content', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-upgrade-')), path = join(root, 'mind.sqlite')
  let mind = new MindStore(path)
  mind.db.prepare('INSERT INTO mind_records VALUES(?,?)').run(record.id, JSON.stringify({...record,revision:4,status:'resolved',updatedAt:'2026-09-10T00:00:00Z'}))
  mind.db.prepare("DELETE FROM mind_commits WHERE id='mind-content-v2'").run()
  mind.close(); mind = new MindStore(path)
  t.after(() => { mind.close(); rmSync(root, {recursive:true,force:true}) })
  assert.equal(mind.view().records[0]!.open, '比较不同领域')
  assert.equal(mind.view().records[0]!.status, 'open')
  assert.equal(mind.view().records[0]!.revision, 5)
  mind.close(); mind = new MindStore(path)
  assert.equal(mind.view().records[0]!.revision, 5)
})

test('Mind semantic observations keep atomic rollback; storage faults are not softened', t => {
  const root = mkdtempSync(join(tmpdir(), 'mind-rejection-')), mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => rmSync(root, {recursive:true,force:true}))
  const seen = mind.view()
  assert.equal(commitMind(mind, {records:[record],acknowledge:['unseen']}, 'conversation', seen), 'unseen_event')
  assert.equal(mind.view().records.length, 0)
  assert.equal(commitMind(mind, {records:[{...record,evidence:[]}]}, 'conversation', seen), 'missing_evidence')
  mind.close()
  assert.throws(() => commitMind(mind, {records:[record]}, 'conversation', seen), /closed|not open/i)
})
