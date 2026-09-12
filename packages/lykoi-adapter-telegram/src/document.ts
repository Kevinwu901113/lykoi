import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
export interface DocumentSend {
  contextId: string
  filename: string
  bytes: Uint8Array
  replyTo?: string | null
}

/** Read a bounded snapshot from this execution's workspace; no caller-supplied root. */
export async function workspaceDocument(workspace: string, path: unknown): Promise<{ filename: string; bytes: Uint8Array }> {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new TypeError('document path must be workspace-relative')
  const root = await realpath(workspace)
  const within = (target: string) => {
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('document is outside workspace')
    return target
  }
  const target = within(resolve(root, path))
  within(await realpath(target))
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1) throw new Error('document must be a regular file with a single hard link')
    if (before.size > DOCUMENT_MAX_BYTES) throw new Error('document exceeds 10 MiB limit')
    // Recheck the name after open, including ancestor symlink swaps, before reading the fd.
    const named = await stat(within(await realpath(target)))
    if (named.dev !== before.dev || named.ino !== before.ino) throw new Error('document changed while opening')
    const buffer = Buffer.alloc(DOCUMENT_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    const after = await file.stat()
    if (length > DOCUMENT_MAX_BYTES) throw new Error('document exceeds 10 MiB limit')
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('document changed while reading')
    return { filename: basename(path), bytes: buffer.subarray(0, length) }
  } finally { await file.close() }
}
