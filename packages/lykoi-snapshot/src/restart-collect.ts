/**
 * restart 线索的**生产采集器**（M2 遗留归位表 #8；SK-163 语义的新体对应物）。
 *
 * 活体（cognition/restart.py + WO-CA-BASELINE-1 §1.1）在启动序里做三件事：
 * `git rev-parse HEAD` 取代码 HEAD、从 systemd 取上次退出到这次启动之间的
 * downtime、`record_deploy_event(unit=…)` 记一条部署事件。`restart.ts` 本体
 * （W5）已经把这三样做成**显式入参** `RestartClues`，本模块就是把入参填上的
 * 那一半 —— 分开是因为采集必然要碰进程外的东西（子进程、systemd），而
 * `recordRestartEvent` 必须保持可测的纯度。
 *
 * **SA-164 是本模块的全部纪律：读不到的线索省略，绝不编造。**
 * 每个采集器各自 try/catch，失败一律回 `null`，并落一条遥测说明**是哪一样
 * 读不到**。三样全读不到也不是错误 —— 她照样醒来，只是这次醒来知道得少一点。
 * 「大约停了 3 小时」如果是猜的，那比不说更糟：她会把一个假事实写进自己的历史。
 *
 * 零真网：`git` 与 `systemctl` 都是本机子进程；本模块不发任何网络请求。
 * 命令执行面做成注入位（`RunCommand`），测试全程零子进程。
 */
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

/**
 * 停机时长（人话）。
 *
 * 取 systemd 的 `InactiveEnterTimestamp`（上一次这个单元停下来的时刻），
 * 与 `now` 求差，再走 `formatDowntime` 的四档渲染（≥1 天只报天数 —— 长睡眠
 * 在她眼里的粒度，SA-163）。
 *
 * 三种情况一律回 null（**绝不编造**）：单元名没给、systemctl 读不到、
 * 时间戳是 `n/a`（单元从没停过 = 这是第一次启动，没有"停了多久"可言）或
 * 解析不出来；差值为负（钟被调过）同样回 null，因为一个负的停机时长是假的。
 */
export function collectDowntime(opts: CollectOptions): string | null {
  if (!opts.unit) return null
  const run = opts.run ?? defaultRunCommand
  let raw: string
  try {
    raw = run('systemctl', ['show', opts.unit, '--property=InactiveEnterTimestamp', '--value']).trim()
  } catch (exc) {
    opts.logEvent?.('restart_clue_unreadable', {
      clue: 'downtime', reason: exc instanceof Error ? exc.name : 'Error',
    })
    return null
  }
  if (raw.length === 0 || raw === 'n/a') {
    opts.logEvent?.('restart_clue_unreadable', { clue: 'downtime', reason: 'never_stopped' })
    return null
  }
  const stoppedAt = Date.parse(raw)
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

/**
 * 部署事件（`record_deploy_event(unit=…)` 的新体对应物，WO-CA-BASELINE-1 §1.1 第 3 步）。
 *
 * 活体把它记进运行时登记处；新体它是**一条遥测行**（`deploy_event`），经
 * `auditLogEvent` 落进同一个 audit.jsonl。刻意不进 immutable 治理账：这不是
 * 「她做了什么」，是「这台机器被部署成了什么样」—— 是运维事实，不是她的行为。
 *
 * 与 restart 事件的分工：`recordRestartEvent` 写进**她的 history**（她读得到、
 * 会想起来）；`recordDeployEvent` 只进审计（运维读，她不读）。同一次启动两条
 * 账，各归各的读者。
 */
export function recordDeployEvent(opts: CollectOptions & { clues?: RestartClues }): void {
  const clues = opts.clues ?? collectRestartClues(opts)
  opts.logEvent?.('deploy_event', {
    unit: opts.unit ?? null,
    head: clues.head ?? null,
    invocation_id: clues.invocationId ?? null,
    downtime: clues.downtime ?? null,
  })
}
