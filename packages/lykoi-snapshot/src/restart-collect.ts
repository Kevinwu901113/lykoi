import { execFileSync } from 'node:child_process'
import { formatDowntime, type RestartClues } from './restart.ts'

/** 子进程执行面（注入位；缺省 = 真 execFileSync，测试替身零子进程）。 */
export type RunCommand = (file: string, args: readonly string[]) => string

/** 缺省实现：短超时、不继承 stdin、stderr 丢弃（采集失败不该刷屏）。 */
export const defaultRunCommand: RunCommand = (file, args) =>
  execFileSync(file, [...args], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

export interface CollectOptions {
  /** 仓库根（git 采集器的 cwd）。 */
  repoRoot: string
  /** systemd 单元名（downtime 采集器问它上次什么时候停的）。 */
  unit?: string
  /** 现在（downtime = now − 上次 Inactive 时刻）。 */
  now: Date
  run?: RunCommand
  logEvent?: (name: string, fields: Record<string, unknown>) => void
}

/**
 * 代码 HEAD（`git rev-parse HEAD`）。
 *
 * 不是 `git describe`、不带 dirty 标记：她要的是「Kevin 改没改我的代码」这一个
 * 事实，`restart.ts` 只取前 8 位渲染进那句话。读不到 → null。
 */
export function collectHead(opts: CollectOptions): string | null {
  const run = opts.run ?? defaultRunCommand
  try {
    const out = run('git', ['-C', opts.repoRoot, 'rev-parse', 'HEAD']).trim()
    // 形状校验：40 位 hex 才算数。读到一句错误提示不等于读到 HEAD。
    if (!/^[0-9a-f]{40}$/.test(out)) {
      opts.logEvent?.('restart_clue_unreadable', { clue: 'head', reason: 'unexpected_shape' })
      return null
    }
    return out
  } catch (exc) {
    opts.logEvent?.('restart_clue_unreadable', {
      clue: 'head', reason: exc instanceof Error ? exc.name : 'Error',
    })
    return null
  }
}

const UTC_TIMESTAMP_RE = /^(?:[A-Za-z]{3} )?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/

export function collectDowntime(opts: CollectOptions): string | null {
  if (!opts.unit) return null
  const run = opts.run ?? defaultRunCommand
  let raw: string
  try {
    raw = run('systemctl', [
      'show', opts.unit, '--property=InactiveEnterTimestamp', '--value', '--timestamp=utc',
    ]).trim()
  } catch (exc) {
    opts.logEvent?.('restart_clue_unreadable', {
      clue: 'downtime', reason: exc instanceof Error ? exc.name : 'Error',
    })
    return null
  }
  // 单元从没停过（这是第一次启动，没有"停了多久"可言）—— 这不是一次读取
  // 失败，是一个合法的"没有这条线索"结局，不落遥测（零事件）。
  if (raw.length === 0 || raw === 'n/a') return null
  const match = UTC_TIMESTAMP_RE.exec(raw)
  if (match === null) {
    opts.logEvent?.('restart_clue_unreadable', { clue: 'downtime', reason: 'unparsable_timestamp' })
    return null
  }
  const stoppedAt = Date.parse(`${match[1]}T${match[2]}Z`)
  if (Number.isNaN(stoppedAt)) {
    opts.logEvent?.('restart_clue_unreadable', { clue: 'downtime', reason: 'unparsable_timestamp' })
    return null
  }
  const seconds = Math.trunc((opts.now.getTime() - stoppedAt) / 1000)
  if (seconds < 0) {
    // 钟被调过。一个负的停机时长是假事实，宁可什么都不说。
    opts.logEvent?.('restart_clue_unreadable', { clue: 'downtime', reason: 'negative_interval' })
    return null
  }
  return formatDowntime(seconds)
}

/** systemd invocation id（每次启动一个新值；env 读得到就带上）。 */
export function collectInvocationId(
  environ: Record<string, string | undefined> = process.env,
): string | null {
  const value = environ.INVOCATION_ID
  return value && value.length > 0 ? value : null
}

/**
 * 三条线索一次采齐（`recordRestartEvent` 的 `clues` 入参就吃这个）。
 * 任何一条读不到就是 `null`，`restart.ts` 那边**缺席即省略**。
 */
export function collectRestartClues(opts: CollectOptions): RestartClues {
  return {
    head: collectHead(opts),
    downtime: collectDowntime(opts),
    invocationId: collectInvocationId(),
  }
}

export function recordDeployEvent(opts: CollectOptions & { clues?: RestartClues }): void {
  const clues = opts.clues ?? collectRestartClues(opts)
  opts.logEvent?.('deploy_event', {
    unit: opts.unit ?? null,
    head: clues.head ?? null,
    invocation_id: clues.invocationId ?? null,
    downtime: clues.downtime ?? null,
  })
}
