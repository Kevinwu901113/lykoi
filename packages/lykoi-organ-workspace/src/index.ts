import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { open, lstat, writeFile, readdir, realpath, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Capability, RuntimeService } from 'lykoi-contracts'

const READ_LIMIT = 16000
const COMMAND_OUTPUT_LIMIT = 1024 * 1024

/** File paths stay inside the configured workspace, including through symlinks. */
export async function workspaceCapabilities(directory: string): Promise<Capability[]> {
  const root = await realpath(directory)
  const within = (path: string) => {
    const rel = relative(root, path)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('path is outside workspace')
    return path
  }
  const locate = async (path: unknown, writing = false) => {
    if (typeof path !== 'string' || !path) throw new TypeError('path must be non-empty')
    const target = within(resolve(root, path))
    if (writing) {
      const exists = await lstat(target).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error
        return false
      })
      within(await realpath(exists ? target : dirname(target)))
    } else within(await realpath(target))
    return target
  }
  return [
    { name: 'workspace.list', description: 'List files in the instance workspace.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
      handler: async p => ({ files: await readdir(await locate(p.path ?? '.')) }) },
    { name: 'workspace.read', description: 'Read a workspace file or command artifact. Use the returned nextOffset (UTF-8 byte offset) to continue a large result.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['path'], additionalProperties: false },
      handler: async p => {
        const file = await open(await locate(p.path), 'r')
        try {
          const offset = (p.offset as number | undefined) ?? 0
          const { size } = await file.stat()
          const buffer = Buffer.alloc(READ_LIMIT + 4)
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
          let end = Math.min(READ_LIMIT, bytesRead)
          // Include the rest of the last UTF-8 character so nextOffset starts a new one.
          while (end < bytesRead && (buffer[end]! & 0xc0) === 0x80) end++
          return { text: buffer.subarray(0, end).toString('utf8'), nextOffset: offset + end < size ? offset + end : null, totalBytes: size }
        } finally { await file.close() }
      } },
    { name: 'workspace.write', description: 'Write a UTF-8 file in the workspace. Existing files are replaced after permission checks.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
      handler: async p => { await writeFile(await locate(p.path, true), p.content as string, 'utf8'); return { written: p.path } } },
    { name: 'terminal.exec', description: 'Run an approved shell command with the workspace as cwd. This is an OS command, not a filesystem sandbox. Large output is retained as a workspace artifact.',
      inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 1, maximum: 120000 } }, required: ['command'], additionalProperties: false },
      handler: async p => {
        const chunks: Buffer[] = []; let bytes = 0; let limited = false; let timedOut = false
        const child = spawn('/bin/sh', ['-c', p.command as string], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8' }, detached: true })
        const stop = () => { try { process.kill(-child.pid!, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
        const capture = (chunk: Buffer) => {
          const remaining = COMMAND_OUTPUT_LIMIT - bytes
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
          bytes += chunk.length
          if (bytes > COMMAND_OUTPUT_LIMIT) { limited = true; stop() }
        }
        child.stdout.on('data', capture); child.stderr.on('data', capture)
        const timeout = setTimeout(() => { timedOut = true; stop() }, (p.timeout_ms as number | undefined) ?? 30000)
        let exitCode: number | null
        try { exitCode = await new Promise<number | null>((ok, fail) => { child.once('error', fail); child.once('close', ok) }) }
        finally { clearTimeout(timeout) }
        const output = Buffer.concat(chunks).toString('utf8')
        let artifact: string | undefined
        if (output.length > READ_LIMIT) {
          await mkdir(join(root, 'artifacts'), { recursive: true })
          artifact = `artifacts/command-${randomUUID()}.txt`
          await writeFile(await locate(artifact, true), output, { flag: 'wx' })
        }
        return { ok: exitCode === 0 && !limited && !timedOut, exitCode, output: output.slice(0, READ_LIMIT), artifact,
          ...(limited ? { error: 'output_limit' } : timedOut ? { error: 'timeout' } : exitCode !== 0 ? { error: 'command_failed' } : {}) }
      } },
  ]
}

export const name = 'lykoi-organ-workspace'
export const inject = ['lykoiRuntime']
export interface Config { directory: string }
export const Config: Schema<Config> = Schema.object({ directory: Schema.string().required() })
export async function apply(ctx: Context, config: Config) {
  // Installing this optional organ creates its workspace; memory restoration is separate.
  await mkdir(config.directory, { recursive: true })
  const capabilities = await workspaceCapabilities(config.directory)
  ctx.effect(() => (ctx.lykoiRuntime as RuntimeService).register({ organId: 'workspace', capabilities, sideEffects: [] }), 'workspace capabilities')
}
