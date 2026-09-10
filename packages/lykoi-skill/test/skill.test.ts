import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CapabilityRuntime } from 'lykoi-runtime'
import type { CharacterInstance } from 'lykoi-contracts'
import * as skillPlugin from '../src/index.ts'
import { SkillStore } from '../src/store.ts'

const input = { title: '异常日志报告', summary: '按证据、影响、核验三栏整理', body: '适用于日志检查。读取原文，每个异常标注行号。不把关联当因果。', source: { kind: 'user' as const, reference: 'message:teaching-1' } }
function fixture(t: import('node:test').TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'skill-test-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
test('revision conflicts, origin retention, restart, delete, and bounded corrupt-file discovery', async t => {
  const root = fixture(t), store = new SkillStore(root, () => new Date('2026-09-10T00:00:00Z'))
  const first = store.save(input)
  const reopened = new SkillStore(root)
  assert.deepEqual(reopened.read(first.id), first)
  const competing = await Promise.allSettled([1, 2].map(n => Promise.resolve().then(() => reopened.save({ ...input, body: `method ${n}`, id: first.id, revision: 1 }))))
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1)
  assert.match((competing.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message, /revision conflict/)
  assert.throws(() => reopened.save({ ...input, id: first.id, revision: 2, source: { kind: 'execution', reference: 'task:other' } }), /original provenance/)
  const corrupt = '0'.repeat(64); writeFileSync(join(root, corrupt + '.json'), '{broken')
  const page = reopened.list('', 0, 1)
  assert.equal(page.errors[0]?.id, corrupt); assert.equal(page.nextOffset, 1)
  const next = reopened.list('method', page.nextOffset!, 1)
  assert.equal(next.skills[0]?.id, first.id); assert.equal(next.nextOffset, null)
  assert.deepEqual(Object.keys(next.skills[0]!).sort(), ['id', 'summary', 'title'])
  reopened.remove(first.id)
  assert.throws(() => new SkillStore(root).read(first.id), { code: 'ENOENT' })
  assert.equal(readdirSync(root).some(f => f.endsWith('.tmp')), false)
})
test('opaque IDs and symlinks cannot read another instance', t => {
  const root = fixture(t), a = new SkillStore(join(root, 'a')), b = new SkillStore(join(root, 'b'))
  const skill = a.save(input)
  assert.throws(() => b.read(skill.id), { code: 'ENOENT' })
  assert.throws(() => b.read('../a/' + skill.id), /invalid skill ID/)
  symlinkSync(join(a.root, skill.id + '.json'), join(b.root, skill.id + '.json'))
  assert.throws(() => b.read(skill.id), { code: 'ELOOP' })
  symlinkSync(a.root, join(root, 'alias'))
  assert.throws(() => new SkillStore(join(root, 'alias')), /instance-owned directory/)
})
test('Cordis shares one instance store, retires handlers, and P3 verifies writes without replay', async t => {
  const root = fixture(t)
  const instance = { id: 'a', stateRoot: root } as CharacterInstance
  const ctx = new Context(), runtime = new CapabilityRuntime(() => {}, instance)
  ctx.provide('lykoiRuntime', runtime)
  const fiber = await ctx.plugin(skillPlugin)
  t.after(() => fiber.dispose())
  const execution = { instanceId: 'a', taskId: 'task-1', operationId: 'op-1', workspace: join(root, 'task-work') }
  const first = await runtime.invoke('skill.save', input, execution) as import('../src/store.ts').Skill
  assert.equal((await runtime.invoke('skill.read', { id: first.id }) as typeof first).body, input.body)
  assert.equal((await runtime.recover('skill.save', input, execution)).status, 'completed')
  await assert.rejects(runtime.invoke('skill.save', input, execution), /already exists/)
  assert.equal(new SkillStore(join(root, 'skills')).read(first.id).revision, 1)
  await assert.rejects(runtime.invoke('skill.read', { id: first.id }, { ...execution, instanceId: 'b' }), /another instance/)
  await assert.rejects(runtime.invoke('skill.list', { path: '../b' }), /path|additional/)
  await runtime.invoke('skill.save', { ...input, id: first.id, revision: 1, body: 'updated method' })
  assert.equal((await runtime.recover('skill.save', input, execution)).status, 'unknown')
  await runtime.invoke('skill.remove', { id: first.id }, { ...execution, operationId: 'op-2' })
  assert.equal((await runtime.recover('skill.remove', { id: first.id }, execution)).status, 'completed')
  const old = runtime.resources.skill!.read!
  await fiber.dispose()
  assert.equal(runtime.capabilities().length, 0)
  await assert.rejects(old({ id: first.id }), /retired|unregistered|unloaded|disposed|registered/)
})
