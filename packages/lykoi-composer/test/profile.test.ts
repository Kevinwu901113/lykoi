import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

test('deployment entry starts independently, refuses a second writer and releases its lock on SIGTERM', async () => {
  const root = mkdtempSync(join(tmpdir(), 'composer-profile-'))
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(r => probe.close(() => r()))
  const config = join(root, 'deployment.json'); writeFileSync(config, JSON.stringify({ stateRoot: root, port }))
  const entry = fileURLToPath(new URL('../../../profile/composer.ts', import.meta.url))
  const child = spawn(process.execPath, [entry, config], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exit = once(child, 'exit')
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('composer entry startup timed out')), 5000)
      let output = ''
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('Composer: http://')) { clearTimeout(timer); resolve() } })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`composer exited during startup: ${code}`)) })
    })
    assert.ok(existsSync(join(root, 'process.lock')))
    const second = spawn(process.execPath, [entry, config], { stdio: 'ignore' })
    const [code] = await once(second, 'exit'); assert.notEqual(code, 0)
    assert.ok(existsSync(join(root, 'process.lock')))
    child.kill('SIGTERM'); const [code2] = await exit
    assert.equal(code2, 0); assert.equal(existsSync(join(root, 'process.lock')), false)
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit }
    rmSync(root, { recursive: true, force: true })
  }
})
