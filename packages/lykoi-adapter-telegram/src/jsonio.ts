import {
  closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

// 与 kernel/jsonio.writeJsonAtomic 同法；本包不 import kernel 的私有面。
export function writeJsonAtomicSync(path: string, obj: unknown): void {
  const directory = dirname(path) || '.'
  mkdirSync(directory, { recursive: true })
  const tmp = join(directory, `.tmp-${randomBytes(8).toString('hex')}.json`)
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, JSON.stringify(obj, null, 2), null, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    renameSync(tmp, path)
  } catch (exc) {
    try { closeSync(fd) } catch { /* 已关闭 */ }
    try { unlinkSync(tmp) } catch { /* 临时文件可能未落地 */ }
    throw exc
  }
}
