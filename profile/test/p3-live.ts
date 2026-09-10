/** Opt-in acceptance against real models, real instance workers and a real Pi process. Uses only a new temporary instance. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { createInstance } from '../instance-state.ts'

assert.equal(process.env.LYKOI_P3_LIVE, '1', 'explicit live acceptance opt-in required')
assert.ok(process.env.DEEPSEEK_API_KEY, 'provider credential required')
assert.ok(process.env.LYKOI_PI_CLI, 'path to verified Pi CLI required')
const root = mkdtempSync(join(tmpdir(), 'lykoi-p3-live-')), registry = join(root, 'instances')
const instance = createInstance({ registry, id: 'acceptance', definition: resolve('packages/lykoi-decide/test/fixtures/instance/persona.toml'), ownerName: '验收者', telegramSenderId: '1' })
const dbPath = join(instance.stateRoot, 'tasks.sqlite'), configPath = join(root, 'runtime.json')
writeFileSync(join(instance.stateRoot, 'approval_rules.json'), JSON.stringify({ always_allow: ['workspace.*', 'task.*', 'delegation.status', 'delegation.collect'], always_deny: [], ask: [] }))
const records: unknown[] = [], workers: ChildProcessWithoutNullStreams[] = []
const record = (type: string, data: unknown) => {
  const item = { type, data, at: new Date().toISOString() }; records.push(item)
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(records, null, 2)); console.log(JSON.stringify(item))
}
const readTasks = (): any[] => {
  const db = new DatabaseSync(dbPath, { readOnly: true }); db.exec('PRAGMA busy_timeout=5000')
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name='persistent_tasks'").get()) return []
    return db.prepare('SELECT document FROM persistent_tasks ORDER BY rowid').all().map(r => JSON.parse(String(r.document)))
  } finally { db.close() }
}
const operations = (id: string): any[] => {
  const db = new DatabaseSync(dbPath, { readOnly: true }); db.exec('PRAGMA busy_timeout=5000')
  try { return db.prepare('SELECT document FROM task_operations WHERE task_id=? ORDER BY rowid').all(id).map(r => JSON.parse(String(r.document))) }
  finally { db.close() }
}
async function until<T>(description: string, read: () => T, match: (value: T) => boolean, timeout = 180000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = read(); if (match(value)) return value; await delay(100) }
  throw new Error(`acceptance timed out: ${description}`)
}
function configuration(pi: boolean) {
  const agentDir = join(root, 'pi-config'); mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { deepseek: { baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKey: '$DEEPSEEK_API_KEY', modelOverrides: { 'deepseek-v4-flash': { maxTokens: 2048, contextWindow: 16384 } } } } }))
  writeFileSync(configPath, JSON.stringify([
    { id: 'runtime', name: 'lykoi-runtime' }, { id: 'audit', name: 'lykoi-audit' },
    { id: 'budget', name: 'lykoi-budget', config: { dailyTotalTokens: 200000 } },
    { id: 'llm', name: '@deepseek-ai/dsh-llm' },
    { id: 'provider', name: 'lykoi-llm-deepseek', config: { thinking: 'enabled', reasoningEffort: 'low', maxTokens: 4096 } },
    { id: 'lykoi-llm', name: 'lykoi-llm' }, { id: 'memory', name: 'lykoi-memory' },
    { id: 'workspace', name: 'lykoi-organ-workspace' },
    { id: 'ingress', name: 'lykoi-ingress', config: { autoStart: false } },
    { id: 'converse', name: 'lykoi-converse', config: { route: 'deepseek-official', model: 'deepseek-v4-flash' } },
    { id: 'tasks', name: 'lykoi-task', config: { route: 'deepseek-official', model: 'deepseek-v4-flash', maxActions: 1, intervalMs: 5000 } },
    ...(pi ? [{ id: 'pi', name: 'lykoi-runner-pi', config: { command: [process.execPath, process.env.LYKOI_PI_CLI, '--thinking', 'low'], provider: 'deepseek', budgetRoute: 'deepseek-official', model: 'deepseek-v4-flash', agentDir, credentialEnv: ['DEEPSEEK_API_KEY'], timeoutMs: 180000, maxTurns: 12 } }] : []),
  ]))
}
function start() {
  const child = spawn(process.execPath, ['profile/instance-worker.ts', '--registry', registry, '--id', instance.id, '--config', configPath, '--console'], { stdio: ['pipe', 'pipe', 'pipe'] })
  workers.push(child)
  const events: any[] = []; let buffer = ''
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      if (line) { const event = JSON.parse(line); events.push(event); record('console', event) }
    }
  })
  child.stderr.on('data', chunk => { record('worker_stderr', chunk.toString()) })
  const stopped = new Promise<void>(resolve => child.once('close', () => resolve()))
  return { child, events, stopped,
    send: (text: string) => { record('user_input', text); child.stdin.write(text + '\n') },
    ready: () => until('worker ready', () => events, e => e.some(x => x.type === 'instance/ready'), 30000),
    crash: async () => { child.kill('SIGKILL'); await stopped; record('worker_crashed', { pid: child.pid }) },
  }
}
try {
  if (!process.argv.includes('--cancel-only')) {
    if (!process.argv.includes('--runner-only')) {
      configuration(false)
      let worker = start(); await worker.ready()
      worker.send('请把下面的事接成后台持续任务，先确认已接下，然后在后台做：研究任务工作目录中的 project 项目，阅读 README.md 和 cognition.ts，把共享认知执行机制、执行边界和改进建议整理成 result.md，完成后告诉我。资料将在接下任务后放入你的任务目录。')
      const [first] = await until('task durably accepted', readTasks, rows => rows.length === 1)
      mkdirSync(join(first.workspace, 'project'))
      writeFileSync(join(first.workspace, 'project', 'README.md'), '这是 P2 共享认知循环的独立验收项目。cognition.ts 是仓库实际源码。请结合代码分析有界循环、能力 observation 和预算收尾。')
      copyFileSync('packages/lykoi-runtime/src/cognition.ts', join(first.workspace, 'project', 'cognition.ts'))
      await until('actual first observation', () => operations(first.id), rows => rows.some(r => r.status === 'completed'))
      worker.send(`/task pause ${first.id}`)
      await until('paused', readTasks, rows => rows[0]?.status === 'paused')
      const heading = `取消边界-${randomUUID().slice(0, 8)}`
      const repliesBefore = worker.events.filter(e => e.type === 'instance/reply').length
      worker.send(`我还在和你聊天。请先回复我一句你收到补充了，并更新刚才那个持续任务：报告必须增加标题为“${heading}”的一节，明确取消不能自动撤销已经发生的外部操作。保留原来的要求，暂时保持暂停，不要新建任务。`)
      await until('foreground reply during persistent task', () => worker.events, events => events.filter(e => e.type === 'instance/reply').length > repliesBefore)
      const updated = (await until('latest requirement persisted', readTasks, rows => rows.length === 1 && rows[0].requirements.includes(heading)))[0]
      record('before_restart', { task: updated, operations: operations(first.id) })
      await worker.crash()
      worker = start(); await worker.ready(); assert.equal(readTasks()[0].status, 'paused')
      worker.send(`/task resume ${first.id}`)
      const completed = (await until('first task completed', readTasks, rows => rows[0]?.status === 'completed'))[0]
      const reportPath = completed.artifacts.find((a: any) => a.path.endsWith('/result.md'))?.path
      assert.ok(reportPath, 'result.md must be a verified artifact')
      const report = readFileSync(reportPath, 'utf8'); assert.ok(report.includes(heading)); assert.ok(completed.artifacts.length)
      await until('first result received on console', () => worker.events, events => events.some(e => e.type === 'task/delivery' && e.taskId === first.id))
      record('first_task_accepted', { task: readTasks()[0], report, operations: operations(first.id) })
      await worker.crash()
    
    }
    configuration(true); let worker = start(); await worker.ready()
    const previousTasks = readTasks().length
    const marker = `receipt-${randomUUID().slice(0, 8)}`
    worker.send(`/task create 请通过 delegation.dispatch 把以下工作整体交给已安装的 Pi Runner，不要自己通过 terminal.exec 或 workspace.write 代做。传给 Runner 的要求：在任务 workspace 中先运行 sleep 12，为重启验证留下窗口；然后编写 validate.mjs，读取 input.json，验证每项 name 非空、amount 是正整数，输出有效项数量和总 amount；实际运行并测试它，将可核验的结果和测试输出写入 runner-report.md。最后由你读取并检查成果，再交付报告。输入文件接下任务后会放入任务 workspace。`)
    const second = (await until('second task accepted', readTasks, rows => rows.length === previousTasks + 1)).at(-1)!
    writeFileSync(join(second.workspace, 'input.json'), JSON.stringify({ marker, items: [{ name: 'one', amount: 7 }, { name: 'two', amount: 11 }] }))
    const approval = await until<any>('runner approval request', () => worker.events.find(e => e.type === 'task/approval' && e.taskId === second.id && e.name === 'delegation.dispatch'), Boolean)
    worker.send(`/task approve ${approval.operationId}`)
    const receiptPath = join(instance.stateRoot, 'runner-pi', approval.operationId, 'receipt.json')
    const running = await until('real Pi working', () => existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null, r => { if (r?.state === 'failed') throw new Error(r.error); return r?.state === 'running' && Boolean(r.progress) }, 60000)
    record('pi_before_restart', running)
    await worker.crash()
    worker = start(); await worker.ready()
    const done = (await until('Pi task completed after host restart', readTasks, rows => rows.at(-1)?.status === 'completed', 240000)).at(-1)!
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    assert.equal(receipt.operationId, approval.operationId)
    const events = readFileSync(join(instance.stateRoot, 'runner-pi', approval.operationId, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(events.filter(e => e.type === 'prompt_intent').length, 1)
    assert.equal(operations(second.id).filter(op => op.name === 'delegation.dispatch').length, 1)
    assert.ok(readFileSync(join(second.workspace, 'runner-report.md'), 'utf8').includes('18'))
    assert.ok(existsSync(join(second.workspace, 'validate.mjs')))
    await until('Runner result received', () => worker.events, events => events.some(e => e.type === 'task/delivery' && e.taskId === second.id))
    record('runner_task_accepted', { task: done, receipt, report: readFileSync(join(second.workspace, 'runner-report.md'), 'utf8') })
    await worker.crash()
  }
  configuration(true)
  const cancellationWorker = start(); await cancellationWorker.ready()
  const countBefore = readTasks().length
  cancellationWorker.send('/task create 通过 delegation.dispatch 将整项工作交给 Pi Runner，不要自行执行：在本任务 workspace 执行一项取消验收：第一步必须运行 sleep 30，等这条命令完成后才可以写 cancelled-output.txt，内容为 done。不要在 sleep 完成之前生成文件。')
  const cancelledTask = (await until('cancellation task accepted', readTasks, rows => rows.length === countBefore + 1)).at(-1)!
  const cancellationApproval = await until<any>('cancellation approval', () => cancellationWorker.events.find(e => e.type === 'task/approval' && e.taskId === cancelledTask.id && e.name === 'delegation.dispatch'), Boolean)
  cancellationWorker.send(`/task approve ${cancellationApproval.operationId}`)
  const cancellationReceipt = join(instance.stateRoot, 'runner-pi', cancellationApproval.operationId, 'receipt.json')
  await until('Pi cancellation window', () => existsSync(cancellationReceipt) ? JSON.parse(readFileSync(cancellationReceipt, 'utf8')) : null, r => r?.state === 'running' && r.progress === 'bash', 60000)
  cancellationWorker.send(`/task cancel ${cancelledTask.id}`)
  const stopped = await until('Pi cancellation confirmed', () => JSON.parse(readFileSync(cancellationReceipt, 'utf8')), r => r.state === 'cancelled', 60000)
  await until('user sees cancelled task', () => cancellationWorker.events, events => events.some(e => e.type === 'task/command' && e.text.includes('"status": "cancelled"')))
  const operationCount = operations(cancelledTask.id).length
  await delay(6000)
  assert.equal(readTasks().at(-1)!.status, 'cancelled')
  assert.equal(operations(cancelledTask.id).length, operationCount)
  assert.equal(existsSync(join(cancelledTask.workspace, 'cancelled-output.txt')), false)
  record('cancellation_accepted', { task: readTasks().at(-1), receipt: stopped, operations: operations(cancelledTask.id) })
  record('complete', { root, budget: JSON.parse(readFileSync(join(instance.stateRoot, 'budget.json'), 'utf8')) })
} catch (error) { record('failed', { error: String(error) }); process.exitCode = 1 }
finally { for (const child of workers) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }
console.log(JSON.stringify({ evidenceRoot: root }))
