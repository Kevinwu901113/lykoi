import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { createInstance, restoreInstance, selectInstance } from '../instance-state.ts'

const fixture = new URL('../../packages/lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname
const cli = new URL('../instance.ts', import.meta.url).pathname
function start(registry: string, config: string, id?: string) {
  const child = spawn(process.execPath, [cli, 'run', '--registry', registry, '--config', config, '--console', ...(id ? ['--id', id] : [])], { stdio: ['pipe', 'pipe', 'pipe'] })
  let error = ''; child.stderr.on('data', b => { error += String(b) })
  const queue: any[] = [], waiters: Array<(v: any) => void> = []
  createInterface({ input: child.stdout }).on('line', line => { let v; try { v = JSON.parse(line) } catch { return }
    if (waiters.length) waiters.shift()!(v); else queue.push(v)
  })
  const done = new Promise<void>((ok, fail) => { child.once('error', fail); child.once('exit', c => { if(c===0)ok();else fail(new Error(error)); }) })
  done.catch(() => {})
  return { child, done, next: () => Promise.race([queue.length ? Promise.resolve(queue.shift()) : new Promise<any>(ok => waiters.push(ok)), done.then(() => { throw new Error('worker exited before reply: '+error) })]) }
}
function config(path: string, model = 'model-one') {
  writeFileSync(path, JSON.stringify([
    { id: 'runtime', name: 'lykoi-runtime' },
    { id: 'workspace', name: 'lykoi-organ-workspace', config: { directory: '/ignored/deployment/path' } },
    { id: 'audit', name: 'lykoi-audit' },
    { id: 'budget', name: 'lykoi-budget', config: { dailyTotalTokens: 100000 } },
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'provider', name: new URL('./continuity-provider.ts', import.meta.url).href },
    { id: 'lykoi-llm', name: 'lykoi-llm' },
    { id: 'memory', name: 'lykoi-memory' },
    { id: 'ingress', name: 'lykoi-ingress', config: { autoStart: false } },
    { id: 'converse', name: 'lykoi-converse', config: { route: 'continuity', model } },
  ]))
}

test('real workers: A/B conversations survive restart, selection and model config change; late A result stays A', { timeout: 30000 }, async () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-process-'))
  const workers: ReturnType<typeof start>[] = []
  try {
    for(const id of ['a','b']) createInstance({ registry, id, definition: fixture, ownerName: 'Owner', telegramSenderId: '1' })
    const file = join(registry, 'runtime.json'); config(file)
    for (const id of ['a','b']) {
      selectInstance(registry, id)
      const worker = start(registry, file); workers.push(worker)
      assert.equal((await worker.next()).instanceId, id)
      worker.child.stdin.write(`Remember P1_MEMORY_${id.toUpperCase()}_127\n`)
      assert.ok((await worker.next()).text.includes(`P1_MEMORY_${id.toUpperCase()}_127`))
      worker.child.stdin.end(); await worker.done
    }
    config(file, 'model-two')
    selectInstance(registry, 'a')
    const a = start(registry, file); workers.push(a); await a.next()
    a.child.stdin.write('P1_WAIT Recall our prior marker\n')
    selectInstance(registry, 'b') // changes the next launch while A has work in flight
    const reply = await a.next()
    assert.equal(reply.instanceId, 'a'); assert.match(reply.text, /P1_MEMORY_A_127/); assert.doesNotMatch(reply.text, /P1_MEMORY_B/)
    a.child.stdin.end(); await a.done
    const b = start(registry, file); workers.push(b); await b.next()
    b.child.stdin.write('Recall our prior marker\n')
    const bReply = await b.next()
    assert.equal(bReply.instanceId, 'b'); assert.match(bReply.text, /P1_MEMORY_B_127/); assert.doesNotMatch(bReply.text, /P1_MEMORY_A/)
    b.child.stdin.end(); await b.done
    for (const id of ['a','b']) {
      const instance = restoreInstance(registry, id)
      assert.ok(existsSync(join(instance.stateRoot, 'workspace')), 'workspace belongs to the selected instance')
      const events = readFileSync(join(instance.stateRoot, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
      assert.ok(events.length > 0)
      assert.ok(events.every(e => e.instance_id === id))
    }
  } finally {
    for (const w of workers) if(w.child.exitCode===null)w.child.kill('SIGTERM')
    await Promise.allSettled(workers.map(w=>w.done))
    rmSync(registry, { recursive: true, force: true })
  }
})

test('audit location belongs to deployment; a restored instance keeps its identity', { timeout: 15000 }, async () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-audit-deployment-'))
  let worker: ReturnType<typeof start> | undefined
  try {
    const instance = createInstance({ registry, id: 'a', definition: fixture, ownerName: 'Owner' })
    const descriptor = readFileSync(join(registry, 'a', 'instance.json'), 'utf8')
    const file = join(registry, 'runtime.json'); config(file)
    const entries = JSON.parse(readFileSync(file, 'utf8'))
    const audit = join(registry, 'deployment-audit.jsonl')
    entries.find((e: any) => e.name === 'lykoi-audit').config = { path: audit }
    writeFileSync(file, JSON.stringify(entries))
    worker = start(registry, file, 'a'); await worker.next()
    worker.child.stdin.write('Remember P1_MEMORY_A_912\n')
    assert.match((await worker.next()).text, /P1_MEMORY_A_912/)
    worker.child.stdin.end(); await worker.done
    const events = readFileSync(audit, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    assert.ok(events.length > 0); assert.ok(events.every(e => e.instance_id === 'a'))
    assert.equal(existsSync(join(instance.stateRoot, 'audit.jsonl')), false)
    assert.equal(readFileSync(join(registry, 'a', 'instance.json'), 'utf8'), descriptor)
  } finally {
    if (worker?.child.exitCode === null) worker.child.kill('SIGTERM')
    if (worker) await Promise.allSettled([worker.done])
    rmSync(registry, { recursive: true, force: true })
  }
})


test('console reports an actual instance-owned capability call, result and final reply', { timeout: 15000 }, async () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-console-capability-'))
  let worker: ReturnType<typeof start> | undefined
  try {
    const instance = createInstance({ registry, id: 'a', definition: fixture, ownerName: 'Owner' })
    mkdirSync(join(instance.stateRoot, 'workspace'))
    writeFileSync(join(instance.stateRoot, 'workspace', 'note.txt'), 'P2_FILE_A_831')
    writeFileSync(join(instance.stateRoot, 'approval_rules.json'), JSON.stringify({ always_allow: ['workspace.read'], always_deny: [], ask: [] }))
    const file = join(registry, 'runtime.json'); config(file)
    worker = start(registry, file, 'a'); await worker.next()
    worker.child.stdin.write('P2_READ read note.txt and report its observed marker\n')
    const started = await worker.next(), result = await worker.next(), reply = await worker.next()
    assert.equal(started.type, 'instance/capability'); assert.equal(started.name, 'workspace.read'); assert.equal(started.phase, 'started')
    assert.equal(result.phase, 'result'); assert.match(result.preview, /P2_FILE_A_831/)
    assert.equal(reply.type, 'instance/reply'); assert.equal(reply.outcome.kind, 'reply'); assert.match(reply.text, /P2_FILE_A_831/)
    assert.ok([started, result, reply].every(event => event.instanceId === 'a'))
    worker.child.stdin.end(); await worker.done
  } finally {
    if (worker?.child.exitCode === null) worker.child.kill('SIGTERM')
    if (worker) await Promise.allSettled([worker.done])
    rmSync(registry, { recursive: true, force: true })
  }
})


test('created instance restarts in a new process after legacy proactive budget migration', () => {
  const registry = mkdtempSync(join(tmpdir(), 'lykoi-budget-restart-'))
  try {
    const instance = createInstance({ registry, id: 'budget', definition: fixture, ownerName: 'Owner', telegramSenderId: '1' })
    const legacy = join(instance.stateRoot, 'messenger_outbound.json')
    assert.equal(existsSync(legacy), false, 'new instances need only the canonical budget')
    writeFileSync(legacy, JSON.stringify(['2026-09-11T00:00:00.000Z']))
    const code = `import {restoreInstance, instanceEnvironment} from ${JSON.stringify(new URL('../instance-state.ts', import.meta.url).href)};
      import {trySend} from ${JSON.stringify(new URL('../../packages/lykoi-kernel/src/proactive-chat.ts', import.meta.url).href)};
      const instance=restoreInstance(${JSON.stringify(registry)}, 'budget');
      Object.assign(process.env,instanceEnvironment(instance));
      console.log(trySend(new Date('2026-09-11T00:00:01.000Z')));`
    for (let run = 0; run < 2; run++) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
      assert.equal(child.status, 0, child.stderr)
      assert.equal(child.stdout.trim(), 'daily_cap')
      assert.equal(existsSync(legacy), false)
      assert.equal(existsSync(legacy + '.migrated'), true)
    }
  } finally { rmSync(registry, { recursive: true, force: true }) }
})
