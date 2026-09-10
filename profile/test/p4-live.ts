/** Opt-in real-model acceptance; only synthetic data in a disposable instance. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { createInstance } from '../instance-state.ts'

assert.equal(process.env.LYKOI_P4_LIVE, '1', 'explicit live acceptance opt-in required')
assert.ok(process.env.DEEPSEEK_API_KEY, 'provider credential required')
const root = mkdtempSync(join(tmpdir(), 'lykoi-p4-live-'))
const registry = join(root, 'instances'), config = join(root, 'runtime.json')
const instance = createInstance({ registry, id: 'skill-acceptance', definition: resolve('packages/lykoi-decide/test/fixtures/instance/persona.toml'), ownerName: '验收者', telegramSenderId: '1' })
const workspace = join(instance.stateRoot, 'workspace'); mkdirSync(workspace, { recursive: true })
writeFileSync(join(instance.stateRoot, 'approval_rules.json'), JSON.stringify({ always_allow: ['workspace.*', 'file.read', 'skill.*', 'task.*'], always_deny: [], ask: [], autonomous: { always_allow: ['skill.*'], always_deny: [] } }))
const records: unknown[] = []
const record = (type: string, data: unknown) => {
  records.push({ type, data }); writeFileSync(join(root, 'evidence.json'), JSON.stringify(records, null, 2)); console.log(JSON.stringify({ type, data }))
}
record('root', { root, instanceId: instance.id })
function configure(alternate: boolean) {
  writeFileSync(config, JSON.stringify([
    { id: 'runtime', name: 'lykoi-runtime' }, { id: 'audit', name: 'lykoi-audit' },
    { id: 'budget', name: 'lykoi-budget', config: { dailyTotalTokens: 160000 } },
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'provider', name: 'lykoi-llm-deepseek', config: { thinking: 'enabled', reasoningEffort: 'low', maxTokens: 4096 } },
    { id: 'lykoi-llm', name: 'lykoi-llm' },
    { id: 'observer', name: new URL('./p4-observer.ts', import.meta.url).href }, { id: 'memory', name: 'lykoi-memory' },
    { id: 'skill', name: 'lykoi-skill' },
    { id: 'workspace', name: alternate ? new URL('./p4-workspace.ts', import.meta.url).href : 'lykoi-organ-workspace' },
    { id: 'ingress', name: 'lykoi-ingress', config: { autoStart: false } },
    { id: 'converse', name: 'lykoi-converse', config: { route: 'deepseek-official', model: 'deepseek-v4-flash' } },
    { id: 'tasks', name: 'lykoi-task', config: { route: 'deepseek-official', model: 'deepseek-v4-flash', maxActions: 6, intervalMs: 3000 } },
  ]))
}
async function until<T>(label: string, read: () => T, match: (value: T) => boolean, timeout = 240000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = read(); if (match(value)) return value; await delay(100) }
  throw new Error(`timeout: ${label}`)
}
function rows(table: string): any[] {
  const db = new DatabaseSync(join(instance.stateRoot, 'tasks.sqlite'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000')
  try { return db.prepare(`SELECT document FROM ${table} ORDER BY rowid`).all().map(r => JSON.parse(String(r.document))) } finally { db.close() }
}
function start() {
  const child = spawn(process.execPath, ['profile/instance-worker.ts', '--registry', registry, '--id', instance.id, '--config', config, '--console'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const events: any[] = []; let buffer = ''
  child.stdout.on('data', chunk => {
    buffer += chunk.toString(); let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      if (line) { const event = JSON.parse(line); events.push(event); record('console', event) }
    }
  })
  child.stderr.on('data', chunk => record('stderr', chunk.toString()))
  const stopped = new Promise<void>(ok => child.once('close', () => ok()))
  return { events, send: (text: string) => { record('input', text); child.stdin.write(text + '\n') },
    ready: () => until('ready', () => events, e => e.some(x => x.type === 'instance/ready'), 30000),
    stop: async () => { child.kill('SIGTERM'); await stopped },
  }
}
const heading = '证据钉 / 影响窗 / 复核步'
const firstMarker = `alpha-${randomUUID().slice(0, 8)}`
writeFileSync(join(workspace, 'first.log'), `01 INFO boot\n02 ERROR ${firstMarker} payment timeout\n03 INFO recovered\n`)
configure(false)
let worker = start()
try {
  await worker.ready()
  worker.send(`读取工作区 first.log，找出异常并写 report-first.md。我的固定报告方法：每个异常严格使用“证据钉 / 影响窗 / 复核步”三个字段，证据钉写原文和行号，影响窗只写日志支持的影响，复核步给出下一步核验，末尾加“未证实项”指出不能下结论的内容。通常用 workspace.read 读取原文，也可按现场能力调整。请把这套方法保存为以后可复用的 Skill，来源 reference 明确写 user:p4-teaching-1；请把通常用 workspace.read 读取原文也写入方法；不要描述成普遍验证有效。`)
  await until('teaching reply', () => worker.events, e => e.some(x => x.type === 'instance/reply'))
  const saved = readdirSync(join(instance.stateRoot, 'skills')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(instance.stateRoot, 'skills', f), 'utf8')))
  assert.equal(saved.length, 1); assert.equal(saved[0].source.kind, 'user')
  assert.equal(saved[0].source.reference, 'user:p4-teaching-1'); assert.ok(saved[0].body.includes('workspace.read'))
  const firstReport = readFileSync(join(workspace, 'report-first.md'), 'utf8')
  assert.ok(firstReport.includes(firstMarker)); assert.ok(firstReport.includes('证据钉'))
  assert.ok(worker.events.some(e => e.type === 'instance/capability' && e.name === 'workspace.read' && e.phase === 'result'))
  record('teaching_pass', { saved, firstReport })
  await worker.stop()
  for (const alternate of [false, true]) {
    configure(alternate); worker = start(); await worker.ready()
    const marker = `${alternate ? 'gamma' : 'beta'}-${randomUUID().slice(0, 8)}`
    // Task has no old conversation in its cognition context. No method text or Skill ID is repeated.
    const before = rows('persistent_tasks').length
    worker.send('/task create 分析本任务 workspace 中 current.log，按我的既有日志报告习惯生成 report.md，核实内容后交付。资料马上放入目录。')
    const task = (await until('task created', () => rows('persistent_tasks'), r => r.length === before + 1))[before]
    writeFileSync(join(task.workspace, 'current.log'), `01 INFO ready\n02 WARN queue 7\n03 ERROR ${marker} upload rejected\n04 INFO retry pending\n`)
    const completed = (await until('task completion', () => rows('persistent_tasks'), r => ['completed', 'failed'].includes(r[before]?.status)))[before]
    assert.equal(completed.status, 'completed')
    const initial = worker.events.find(e => e.type === 'p4/model_input' && JSON.stringify(e.input).includes(task.id))
    assert.ok(initial); assert.ok(!JSON.stringify(initial.input).includes('证据钉'), 'new task must not inherit the taught method before Skill discovery')
    const report = readFileSync(join(task.workspace, 'report.md'), 'utf8')
    for (const token of ['证据钉', '影响窗', '复核步', '未证实项', marker]) assert.ok(report.includes(token), `missing ${token}`)
    assert.ok(!report.includes(firstMarker))
    const operations = rows('task_operations').filter(o => o.taskId === task.id)
    assert.ok(operations.some(o => o.name === 'skill.list' && o.status === 'completed'))
    assert.ok(operations.some(o => o.name === 'skill.read' && o.status === 'completed'))
    assert.ok(operations.some(o => o.name === (alternate ? 'file.read' : 'workspace.read') && o.status === 'completed'))
    await until('delivery received', () => worker.events, e => e.some(x => x.type === 'task/delivery' && x.taskId === task.id))
    record(alternate ? 'adaptation_pass' : 'restart_reuse_pass', { task: completed, report, operations, teachingFields: heading })
    await worker.stop()
  }
  record('all_passed', { root })
} finally { await worker.stop() }
