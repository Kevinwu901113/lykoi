/**
 * 原子 JSON 落盘（shared/jsonio.write_json_atomic 对应物）。
 *
 * 持久 state（审批规则、pending 队列、通知）每次整文件重写：同目录临时文件 →
 * `rename` 原地替换（POSIX 原子），崩溃在写中途也不会留下半截文件 —— 读者
 * 永远看到旧完整文件或新完整文件之一。
 *
 * 锁纪律的移植说明（GK-4 同源）：活体的 file_lock 是跨进程 flock（surface 与
 * autonomy 两个进程共写）；新体插件树**单进程**，本模块的读-改-写全部走
 * node:fs 同步 API、中间无 await，进程内天然串行 —— 跨进程锁面随之消灭，
 * 不是被省略。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function writeJsonAtomic(path: string, obj: unknown): void {
  const directory = dirname(path) || '.'
  mkdirSync(directory, { recursive: true })
  const tmp = join(directory, `.tmp-${randomBytes(8).toString('hex')}.json`)
  const fd = openSync(tmp, 'w')
  try {
    // Python json.dump(ensure_ascii=False, indent=2) 的对应形态：indent 2。
    writeSync(fd, JSON.stringify(obj, null, 2), null, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    renameSync(tmp, path) // POSIX 原子替换
  } catch (exc) {
    try {
      closeSync(fd)
    } catch {
      /* 已关闭 */
    }
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件可能未落地 */
    }
    throw exc
  }
}
